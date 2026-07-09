// backend/src/lib/jwt.ts
// JWT helpers for access tokens (short-lived, Authorization header) and
// refresh tokens (long-lived, httpOnly cookie).
// Never import env directly from process.env — always use src/config/env.ts.

import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface JwtPayload {
  sub: string; // userId
  email: string;
}

/** Signs a short-lived access token (default 15m). */
export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

/** Signs a long-lived refresh token (default 7d). */
export function signRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

/** Verifies an access token. Throws if invalid or expired. */
export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

/** Verifies a refresh token. Throws if invalid or expired. */
export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtPayload;
}
