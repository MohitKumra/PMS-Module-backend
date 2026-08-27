// backend/src/controllers/adminAuth.controller.ts
// Handles admin authentication routes with secure HttpOnly cookies.

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { sendAdminOtp, verifyAdminOtp, refreshAdminSession, getAdminProfile } from '../services/adminAuth.service';
import { env } from '../config/env';

const isProd = env.NODE_ENV === 'production';
const adminCookieSameSite = isProd ? ('none' as const) : ('lax' as const);

const sendOtpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const verifyOtpSchema = z.object({
  email: z.string().email(),
  code: z.string().min(6).max(6),
});

export async function sendOtpHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = sendOtpSchema.parse(req.body);
    const result = await sendAdminOtp(email, password);
    res.json({
      success: true,
      message: 'Verification code sent to administrative email',
      data: { email: result.email },
    });
  } catch (err) {
    next(err);
  }
}

export async function verifyOtpHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, code } = verifyOtpSchema.parse(req.body);
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string);
    const userAgent = req.headers['user-agent'];

    const result = await verifyAdminOtp(email, code, { ipAddress, userAgent });

    // Set secure HttpOnly cookies for session
    res.cookie('adminAccessToken', result.accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: adminCookieSameSite,
      maxAge: 15 * 60 * 1000, // 15 minutes
    });

    res.cookie('adminRefreshToken', result.refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: adminCookieSameSite,
      path: '/api/admin/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({
      success: true,
      data: {
        accessToken: result.accessToken,
        admin: result.admin,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function refreshHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const refreshToken = req.cookies?.adminRefreshToken || req.body?.refreshToken;
    if (!refreshToken) {
      res.status(401).json({
        error: { code: 'NO_REFRESH_TOKEN', message: 'No admin refresh token provided' },
      });
      return;
    }

    const result = await refreshAdminSession(refreshToken);

    res.cookie('adminAccessToken', result.accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: adminCookieSameSite,
      maxAge: 15 * 60 * 1000,
    });

    res.cookie('adminRefreshToken', result.refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: adminCookieSameSite,
      path: '/api/admin/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      data: { accessToken: result.accessToken },
    });
  } catch (err) {
    next(err);
  }
}

export async function logoutHandler(req: Request, res: Response): Promise<void> {
  res.clearCookie('adminAccessToken');
  res.clearCookie('adminRefreshToken', { path: '/api/admin/auth' });
  res.json({ success: true, message: 'Logged out successfully' });
}

export async function getMeHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.admin) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
      return;
    }

    const profile = await getAdminProfile(req.admin.sub);
    res.json({ success: true, data: profile });
  } catch (err) {
    next(err);
  }
}