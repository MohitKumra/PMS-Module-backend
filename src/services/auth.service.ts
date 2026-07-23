// backend/src/services/auth.service.ts
// Handles authentication business logic: signup, login, token refresh,
// Google sign-in handoff, and password reset/change flows.

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../lib/prismaClient';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt';
import { sendMail, passwordResetEmail, recoveryByEmailEmail } from '../lib/mailer';
import { createError } from '../middleware/errorHandler';
import { env } from '../config/env';
import type { AuthResponse, UserDTO } from '../types';
import { getRecoveryTargetEmail } from './settings.service';

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

function normalizeTimezone(timezone?: string | null): string | null {
  if (!timezone?.trim()) return null;
  const candidate = timezone.trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return null;
  }
}

function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ---------------------------------------------------------------------------
// Signup
// ---------------------------------------------------------------------------

export async function signup(
  email: string,
  password: string,
  name?: string,
  timezone?: string | null,
): Promise<AuthResponse> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw createError(409, 'EMAIL_IN_USE', 'An account with this email already exists');

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name: name ?? null,
      timezone: normalizeTimezone(timezone) ?? 'UTC',
      preferences: { create: {} },
      notificationPreferences: { create: {} },
    },
  });

  const payload = { sub: user.id, email: user.email };
  return {
    accessToken: signAccessToken(payload),
    user: toUserDTO(user),
  };
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export async function login(
  email: string,
  password: string,
  timezone?: string | null,
): Promise<{ response: AuthResponse; refreshToken: string }> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    throw createError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw createError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');

  const normalizedTimezone = normalizeTimezone(timezone);
  const effectiveUser =
    normalizedTimezone && normalizedTimezone !== user.timezone
      ? await prisma.user.update({
          where: { id: user.id },
          data: { timezone: normalizedTimezone },
        })
      : user;

  const payload = { sub: effectiveUser.id, email: effectiveUser.email };
  return {
    response: { accessToken: signAccessToken(payload), user: toUserDTO(effectiveUser) },
    refreshToken: signRefreshToken(payload),
  };
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

export async function refreshTokens(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw createError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) throw createError(401, 'USER_NOT_FOUND', 'User no longer exists');

  const newPayload = { sub: user.id, email: user.email };
  return {
    accessToken: signAccessToken(newPayload),
    refreshToken: signRefreshToken(newPayload),
  };
}

// ---------------------------------------------------------------------------
// Password Reset / Password Change
// ---------------------------------------------------------------------------

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw createError(404, 'EMAIL_NOT_FOUND', 'No account found with that email address');
  }

  const token = crypto.randomBytes(32).toString('hex');
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashResetToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${token}`;
  const deliveryEmail = (await getRecoveryTargetEmail(user.id)) ?? email;
  await sendMail({ to: deliveryEmail, subject: 'Reset your password', html: passwordResetEmail(resetUrl) });
}

export async function requestPasswordResetByRecoveryEmail(recoveryEmail: string): Promise<void> {
  const user = await prisma.user.findFirst({ where: { recoveryEmail } });
  if (!user) {
    throw createError(404, 'RECOVERY_EMAIL_NOT_FOUND', 'No account found with that recovery email');
  }

  const token = crypto.randomBytes(32).toString('hex');
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashResetToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${token}`;
  const deliveryEmail = user.recoveryEmail ?? user.email;
  // Send the reset link to the recovery email and show the user their primary email
  await sendMail({
    to: deliveryEmail,
    subject: 'Recover your Finamite account',
    html: recoveryByEmailEmail(resetUrl, user.email!),
  });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const entry = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
  });

  if (!entry || entry.expiresAt.getTime() < Date.now() || entry.consumedAt) {
    throw createError(400, 'INVALID_RESET_TOKEN', 'Password reset token is invalid or expired');
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id: entry.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({
      where: { id: entry.id },
      data: { consumedAt: new Date() },
    }),
  ]);
}

export async function setPassword(userId: string, newPassword: string): Promise<void> {
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}

export async function changePassword(
  userId: string,
  currentPassword: string | undefined,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw createError(404, 'USER_NOT_FOUND', 'User not found');
  if (!user.passwordHash) {
    throw createError(400, 'PASSWORD_NOT_SET', 'No password is set for this account');
  }
  if (!currentPassword) {
    throw createError(400, 'CURRENT_PASSWORD_REQUIRED', 'Current password is required');
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    throw createError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}

// ---------------------------------------------------------------------------
// Current user
// ---------------------------------------------------------------------------

export async function getMe(userId: string): Promise<UserDTO> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw createError(404, 'USER_NOT_FOUND', 'User not found');
  return toUserDTO(user);
}
