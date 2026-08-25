// backend/src/lib/adminJwt.ts
// Independent JWT helpers for Admin authentication.
// Uses dedicated JWT_ADMIN_SECRET completely isolated from normal user tokens.

import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { AdminRole } from '@prisma/client';

export interface AdminJwtPayload {
  sub: string; // adminAccountId
  email: string;
  role: AdminRole;
}

/** Signs a short-lived admin access token (default 15m). */
export function signAdminAccessToken(payload: AdminJwtPayload): string {
  return jwt.sign(payload, env.JWT_ADMIN_SECRET, {
    expiresIn: env.JWT_ADMIN_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

/** Signs an admin refresh token (7d) using a derived secret. */
export function signAdminRefreshToken(payload: AdminJwtPayload): string {
  return jwt.sign(payload, `${env.JWT_ADMIN_SECRET}_REFRESH_KEY`, {
    expiresIn: '7d',
  });
}

/** Verifies an admin access token. */
export function verifyAdminAccessToken(token: string): AdminJwtPayload {
  return jwt.verify(token, env.JWT_ADMIN_SECRET) as AdminJwtPayload;
}

/** Verifies an admin refresh token. */
export function verifyAdminRefreshToken(token: string): AdminJwtPayload {
  return jwt.verify(token, `${env.JWT_ADMIN_SECRET}_REFRESH_KEY`) as AdminJwtPayload;
}