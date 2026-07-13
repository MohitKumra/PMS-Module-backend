import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prismaClient';
import { env } from '../config/env';
import { createError } from '../middleware/errorHandler';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt';
import type {
  GoogleAuthPurpose,
  GoogleCalendarIntegrationDTO,
  GoogleCalendarSyncResponse,
  GoogleAuthStartResponse,
  UserDTO,
} from '../types';

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
};

type GoogleProfile = {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

type GoogleOAuthState = {
  purpose: GoogleAuthPurpose;
  returnTo: string;
};

const GOOGLE_OAUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

const GOOGLE_SCOPES: Record<GoogleAuthPurpose, string[]> = {
  signin: ['openid', 'email', 'profile'],
  'calendar-connect': ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/calendar.events'],
};

function hashSecret(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function encryptionKey(): Buffer {
  return crypto.createHash('sha256').update(env.JWT_REFRESH_SECRET).digest();
}

function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), encrypted.toString('base64'), tag.toString('base64')].join(':');
}

function decryptSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  const [version, ivB64, encryptedB64, tagB64] = value.split(':');
  if (version !== 'v1' || !ivB64 || !encryptedB64 || !tagB64) return value;
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

function signGoogleState(state: GoogleOAuthState): string {
  return jwt.sign(state, env.JWT_SECRET, { expiresIn: '10m' });
}

function verifyGoogleState(state: string): GoogleOAuthState {
  return jwt.verify(state, env.JWT_SECRET) as GoogleOAuthState;
}

export function buildGoogleAuthUrl(purpose: GoogleAuthPurpose, returnTo: string): GoogleAuthStartResponse {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw createError(503, 'GOOGLE_NOT_CONFIGURED', 'Google OAuth is not configured');
  }

  const state = signGoogleState({ purpose, returnTo });
  const redirectUri = `${env.BACKEND_URL}/api/auth/google/callback`;
  const scopes = GOOGLE_SCOPES[purpose].join(' ');
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });

  return { url: `${GOOGLE_OAUTH_BASE}?${params.toString()}` };
}

async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  const redirectUri = `${env.BACKEND_URL}/api/auth/google/callback`;
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw createError(400, 'GOOGLE_TOKEN_EXCHANGE_FAILED', `Failed to exchange Google auth code: ${text}`);
  }

  return response.json() as Promise<GoogleTokenResponse>;
}

async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw createError(400, 'GOOGLE_PROFILE_FAILED', `Failed to fetch Google profile: ${text}`);
  }
  return response.json() as Promise<GoogleProfile>;
}

async function revokeGoogleToken(token: string): Promise<void> {
  await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
}

async function refreshGoogleAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw createError(400, 'GOOGLE_REFRESH_FAILED', `Failed to refresh Google access token: ${text}`);
  }

  return response.json() as Promise<GoogleTokenResponse>;
}

function toUserDTO(user: {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  recoveryEmail: string | null;
  timezone: string;
  passwordHash: string | null;
  googleId: string | null;
  createdAt: Date;
}): UserDTO {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    recoveryEmail: user.recoveryEmail,
    timezone: user.timezone,
    hasPassword: Boolean(user.passwordHash),
    hasGoogle: Boolean(user.googleId),
    createdAt: user.createdAt.toISOString(),
  };
}

export async function handleGoogleAuthCallback(code: string, state: string, currentUserId?: string): Promise<{
  user: UserDTO;
  accessToken: string;
  refreshToken: string;
  redirectTo: string;
}> {
  if (!code) throw createError(400, 'MISSING_GOOGLE_CODE', 'Google authorization code missing');

  const parsedState = verifyGoogleState(state);
  const tokens = await exchangeCodeForTokens(code);
  const profile = await fetchGoogleProfile(tokens.access_token);

  const googleEmail = profile.email?.trim().toLowerCase();
  if (!googleEmail) {
    throw createError(400, 'GOOGLE_EMAIL_MISSING', 'Google account email was not returned');
  }

  const refreshTokenEncrypted = tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null;
  const accessTokenEncrypted = encryptSecret(tokens.access_token);
  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000);

  const existingByGoogleId = await prisma.user.findUnique({ where: { googleId: profile.sub } });
  const existingByEmail = await prisma.user.findUnique({ where: { email: googleEmail } });

  let user =
    existingByGoogleId ??
    existingByEmail ??
    (parsedState.purpose === 'calendar-connect' && currentUserId
      ? await prisma.user.findUnique({ where: { id: currentUserId } })
      : null);

  if (!user) {
    user = await prisma.user.create({
      data: {
        email: googleEmail,
        googleId: profile.sub,
        name: profile.name ?? null,
        avatarUrl: profile.picture ?? null,
        timezone: 'UTC',
        passwordHash: null,
        recoveryEmail: null,
        preferences: { create: {} },
        notificationPreferences: { create: {} },
      },
    });
  }

  if (parsedState.purpose === 'calendar-connect' && !currentUserId) {
    throw createError(401, 'UNAUTHORIZED', 'You must be signed in to connect Google Calendar');
  }

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      email: googleEmail,
      googleId: profile.sub,
      name: profile.name ?? user.name,
      avatarUrl: profile.picture ?? user.avatarUrl,
    },
  });

  if (parsedState.purpose === 'calendar-connect') {
    await prisma.googleCalendarConnection.upsert({
      where: { userId: updatedUser.id },
      create: {
        userId: updatedUser.id,
        googleAccountId: profile.sub,
        googleEmail,
        accessToken: accessTokenEncrypted,
        refreshToken: refreshTokenEncrypted,
        scope: tokens.scope ?? GOOGLE_SCOPES['calendar-connect'].join(' '),
        expiresAt,
        isActive: true,
      },
      update: {
        googleAccountId: profile.sub,
        googleEmail,
        accessToken: accessTokenEncrypted,
        ...(refreshTokenEncrypted ? { refreshToken: refreshTokenEncrypted } : {}),
        scope: tokens.scope ?? GOOGLE_SCOPES['calendar-connect'].join(' '),
        expiresAt,
        isActive: true,
        revokedAt: null,
      },
    });
  }

  const payload = { sub: updatedUser.id, email: updatedUser.email };
  return {
    user: toUserDTO(updatedUser),
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
    redirectTo: parsedState.returnTo,
  };
}

export async function getGoogleCalendarIntegration(userId: string): Promise<GoogleCalendarIntegrationDTO> {
  const connection = await prisma.googleCalendarConnection.findUnique({ where: { userId } });
  return {
    connected: Boolean(connection?.isActive),
    googleEmail: connection?.googleEmail ?? null,
    calendarId: connection?.calendarId ?? null,
    connectedAt: connection?.connectedAt.toISOString() ?? null,
    lastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null,
    isActive: Boolean(connection?.isActive),
    syncTasks: connection?.syncTasks ?? true,
  };
}

async function getValidAccessToken(connection: {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
  googleAccountId: string;
}): Promise<string> {
  const accessToken = decryptSecret(connection.accessToken);
  if (accessToken && connection.expiresAt && connection.expiresAt.getTime() > Date.now() + 60_000) {
    return accessToken;
  }

  const refreshToken = decryptSecret(connection.refreshToken);
  if (!refreshToken) {
    throw createError(400, 'GOOGLE_REFRESH_TOKEN_MISSING', 'Google refresh token is missing');
  }

  const refreshed = await refreshGoogleAccessToken(refreshToken);
  return refreshed.access_token;
}

function formatDateInTimeZone(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

async function callGoogleCalendarApi(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  accessToken: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; json?: any }> {
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const json = text ? (() => {
    try { return JSON.parse(text); } catch { return text; }
  })() : undefined;
  return { ok: response.ok, status: response.status, json };
}

export async function syncGoogleCalendarTasks(userId: string): Promise<GoogleCalendarSyncResponse> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw createError(404, 'USER_NOT_FOUND', 'User not found');

  const connection = await prisma.googleCalendarConnection.findUnique({ where: { userId } });
  if (!connection || !connection.isActive) {
    throw createError(400, 'GOOGLE_CALENDAR_NOT_CONNECTED', 'Google Calendar is not connected');
  }

  const accessToken = await getValidAccessToken(connection);
  const targetCalendarId = connection.calendarId || 'primary';

  const tasks = await prisma.task.findMany({
    where: { userId, dueDate: { not: null } },
    orderBy: { dueDate: 'asc' },
  });

  const syncItems = await prisma.googleCalendarSyncItem.findMany({
    where: { userId, localType: 'TASK' },
  });
  const syncByTaskId = new Map(syncItems.map((item) => [item.localId, item]));

  let created = 0;
  let updated = 0;
  let deleted = 0;
  let skipped = 0;

  for (const task of tasks) {
    if (!task.dueDate) {
      skipped += 1;
      continue;
    }

    const existing = syncByTaskId.get(task.id);
    const date = formatDateInTimeZone(task.dueDate, user.timezone || 'UTC');
    const payload = {
      summary: task.title,
      description: [
        task.description ?? '',
        `FlowSpace task: ${task.status}`,
        `Priority: ${task.priority}`,
      ].filter(Boolean).join('\n\n'),
      start: { date },
      end: { date: formatDateInTimeZone(new Date(task.dueDate.getTime() + 24 * 60 * 60 * 1000), user.timezone || 'UTC') },
    };

    if (existing) {
      const result = await callGoogleCalendarApi(
        'PATCH',
        `/calendars/${encodeURIComponent(existing.calendarId || targetCalendarId)}/events/${encodeURIComponent(existing.googleEventId)}`,
        accessToken,
        payload,
      );

      if (result.ok) {
        updated += 1;
        continue;
      }

      if (result.status !== 404) {
        throw createError(400, 'GOOGLE_CALENDAR_UPDATE_FAILED', 'Failed to update Google Calendar event');
      }
    }

    const result = await callGoogleCalendarApi(
      'POST',
      `/calendars/${encodeURIComponent(targetCalendarId)}/events`,
      accessToken,
      {
        ...payload,
        reminders: { useDefault: true },
      },
    );

    if (!result.ok || !result.json?.id) {
      throw createError(400, 'GOOGLE_CALENDAR_CREATE_FAILED', 'Failed to create Google Calendar event');
    }

    await prisma.googleCalendarSyncItem.upsert({
      where: {
        userId_localType_localId: {
          userId,
          localType: 'TASK',
          localId: task.id,
        },
      },
      create: {
        userId,
        localType: 'TASK',
        localId: task.id,
        googleEventId: String(result.json.id),
        calendarId: targetCalendarId,
      },
      update: {
        googleEventId: String(result.json.id),
        calendarId: targetCalendarId,
      },
    });

    created += 1;
  }

  const validTaskIds = new Set(tasks.map((task) => task.id));
  const staleSyncItems = syncItems.filter((item) => !validTaskIds.has(item.localId));

  for (const stale of staleSyncItems) {
    const result = await callGoogleCalendarApi(
      'DELETE',
      `/calendars/${encodeURIComponent(stale.calendarId || targetCalendarId)}/events/${encodeURIComponent(stale.googleEventId)}`,
      accessToken,
    );
    if (result.ok || result.status === 404) {
      deleted += 1;
      await prisma.googleCalendarSyncItem.delete({ where: { id: stale.id } });
    } else {
      skipped += 1;
    }
  }

  await prisma.googleCalendarConnection.update({
    where: { userId },
    data: {
      accessToken: encryptSecret(accessToken),
      expiresAt: new Date(Date.now() + 55 * 60 * 1000),
      lastSyncedAt: new Date(),
    },
  });

  return { synced: created + updated + deleted, created, updated, deleted, skipped };
}

export async function disconnectGoogleCalendar(userId: string): Promise<void> {
  const connection = await prisma.googleCalendarConnection.findUnique({ where: { userId } });
  if (!connection) return;

  const syncItems = await prisma.googleCalendarSyncItem.findMany({ where: { userId, localType: 'TASK' } });

  try {
    const accessToken = await getValidAccessToken(connection);
    for (const item of syncItems) {
      await callGoogleCalendarApi(
        'DELETE',
        `/calendars/${encodeURIComponent(connection.calendarId || 'primary')}/events/${encodeURIComponent(item.googleEventId)}`,
        accessToken,
      );
    }
    if (connection.refreshToken) {
      await revokeGoogleToken(decryptSecret(connection.refreshToken) ?? '');
    }
  } catch {
    // Best-effort disconnect. We still clear the local connection below.
  }

  await prisma.googleCalendarSyncItem.deleteMany({ where: { userId, localType: 'TASK' } });
  await prisma.googleCalendarConnection.update({
    where: { userId },
    data: {
      isActive: false,
      revokedAt: new Date(),
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
    },
  });
}

export function buildGoogleAuthRedirect(purpose: GoogleAuthPurpose, returnTo: string): GoogleAuthStartResponse {
  return buildGoogleAuthUrl(purpose, returnTo);
}
