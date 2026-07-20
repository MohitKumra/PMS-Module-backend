// backend/src/controllers/auth.controller.ts
// Thin request/response layer — delegates all logic to auth.service.ts.
// Sets the refresh token as an httpOnly cookie on login/refresh.

import { Request, Response, NextFunction } from 'express';
import * as authService from '../services/auth.service';
import * as googleService from '../services/google.service';
import { z } from 'zod';
import { verifyRefreshToken } from '../lib/jwt';
import { env } from '../config/env';

const REFRESH_COOKIE = 'refreshToken';
const COOKIE_OPTS = {
  httpOnly: true, secure: process.env.NODE_ENV === 'production',
  sameSite: 'none' as const, maxAge: 7 * 24 * 60 * 60 * 1000,
};

export async function signup(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password, name } = req.body;
    const timezone = req.headers['x-client-timezone'];
    const result = await authService.signup(
      email,
      password,
      name,
      typeof timezone === 'string' ? timezone : undefined,
    );
    res.status(201).json(result);
  } catch (err) { next(err); }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    const timezone = req.headers['x-client-timezone'];
    const { response, refreshToken } = await authService.login(
      email,
      password,
      typeof timezone === 'string' ? timezone : undefined,
    );
    res.cookie(REFRESH_COOKIE, refreshToken, COOKIE_OPTS);
    res.json(response);
  } catch (err) { next(err); }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) { res.status(401).json({ error: { code: 'NO_REFRESH_TOKEN', message: 'No refresh token' } }); return; }
    const tokens = await authService.refreshTokens(token);
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, COOKIE_OPTS);
    res.json({ accessToken: tokens.accessToken });
  } catch (err) { next(err); }
}

export async function logout(_req: Request, res: Response) {
  res.clearCookie(REFRESH_COOKIE);
  res.json({ success: true });
}

export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    await authService.requestPasswordReset(req.body.email);
    res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (err) { next(err); }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    await authService.resetPassword(req.body.token, req.body.password);
    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) { next(err); }
}

export async function getMe(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await authService.getMe(req.user!.sub);
    res.json(user);
  } catch (err) { next(err); }
}

export async function googleStart(req: Request, res: Response, next: NextFunction) {
  try {
    const purpose = req.query.purpose === 'calendar-connect' ? 'calendar-connect' : 'signin';
    const returnTo = typeof req.query.returnTo === 'string' && req.query.returnTo.trim()
      ? req.query.returnTo.trim()
      : purpose === 'calendar-connect'
        ? `${env.FRONTEND_URL}/settings?integration=google-calendar`
        : `${env.FRONTEND_URL}/google/callback`;
    const { url } = googleService.buildGoogleAuthRedirect(purpose, returnTo);
    res.json({ url });
  } catch (err) { next(err); }
}

export async function googleCallback(req: Request, res: Response, next: NextFunction) {
  try {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const currentRefreshToken = req.cookies?.[REFRESH_COOKIE];
    let currentUserId: string | undefined;

    if (currentRefreshToken) {
      try {
        const payload = verifyRefreshToken(currentRefreshToken);
        currentUserId = payload.sub;
      } catch {
        currentUserId = undefined;
      }
    }

    const result = await googleService.handleGoogleAuthCallback(code, state, currentUserId);
    res.cookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTS);
    res.redirect(result.redirectTo);
  } catch (err) { next(err); }
}

export async function changePassword(req: Request, res: Response, next: NextFunction) {
  try {
    await authService.changePassword(req.user!.sub, req.body.currentPassword, req.body.newPassword);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function setPassword(req: Request, res: Response, next: NextFunction) {
  try {
    await authService.setPassword(req.user!.sub, req.body.newPassword);
    res.json({ success: true });
  } catch (err) { next(err); }
}
