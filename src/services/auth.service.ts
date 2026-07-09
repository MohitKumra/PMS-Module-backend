// backend/src/services/auth.service.ts
// Handles all authentication business logic: signup, login, token refresh,
// and password reset flow. Depends on Prisma, bcryptjs, and jwt helpers.
// Framework-agnostic — does not import from Express.

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../lib/prismaClient';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt';
import { sendMail, passwordResetEmail } from '../lib/mailer';
import { createError } from '../middleware/errorHandler';
import { env } from '../config/env';
import type { UserDTO, AuthResponse } from '../types';

/** Converts a Prisma User row to the public-facing DTO (no sensitive fields). */
function toUserDTO(user: {
  id: string; email: string; name: string | null;
  avatarUrl: string | null; timezone: string; createdAt: Date;
}): UserDTO {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    timezone: user.timezone,
    createdAt: user.createdAt.toISOString(),
  };
}

// ─── Signup ───────────────────────────────────────────────────────────────────

export async function signup(email: string, password: string, name?: string): Promise<AuthResponse> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw createError(409, 'EMAIL_IN_USE', 'An account with this email already exists');

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, passwordHash, name: name ?? null },
  });

  const payload = { sub: user.id, email: user.email };
  return {
    accessToken: signAccessToken(payload),
    user: toUserDTO(user),
  };
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function login(email: string, password: string): Promise<{ response: AuthResponse; refreshToken: string }> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    throw createError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw createError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');

  const payload = { sub: user.id, email: user.email };
  return {
    response: { accessToken: signAccessToken(payload), user: toUserDTO(user) },
    refreshToken: signRefreshToken(payload),
  };
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

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

// ─── Password Reset ──────────────────────────────────────────────────────────
// Simple token-based reset: token stored in avatarUrl field temporarily
// (Phase 1 shortcut — add a proper PasswordResetToken table later if needed).
// The token is a 32-byte hex string, valid for 1 hour.

// We store reset tokens in a simple in-memory map for Phase 1.
// In production, store these in the DB with expiry.
const resetTokens = new Map<string, { userId: string; expiresAt: number }>();

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  // Always return success to prevent user enumeration attacks
  if (!user) return;

  const token = crypto.randomBytes(32).toString('hex');
  resetTokens.set(token, { userId: user.id, expiresAt: Date.now() + 60 * 60 * 1000 });

  const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${token}`;
  await sendMail({ to: email, subject: 'Reset your password', html: passwordResetEmail(resetUrl) });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const entry = resetTokens.get(token);
  if (!entry || entry.expiresAt < Date.now()) {
    throw createError(400, 'INVALID_RESET_TOKEN', 'Password reset token is invalid or expired');
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: entry.userId }, data: { passwordHash } });
  resetTokens.delete(token);
}

// ─── Get current user ─────────────────────────────────────────────────────────

export async function getMe(userId: string): Promise<UserDTO> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw createError(404, 'USER_NOT_FOUND', 'User not found');
  return toUserDTO(user);
}
