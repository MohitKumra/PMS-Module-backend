// backend/src/middleware/authenticate.ts
// JWT authentication middleware.
// Reads the Bearer token from the Authorization header, verifies it,
// and attaches the decoded payload as `req.user` for downstream handlers.
// Responds 401 if the token is missing, malformed, or expired.

import type { Request, Response, NextFunction } from 'express';
import type { JwtPayload } from '../lib/jwt';
import { verifyAccessToken } from '../lib/jwt';
import { prisma } from '../lib/prismaClient';

// Extend Express Request to carry the authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or malformed Authorization header' } });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyAccessToken(token);

    // Verify the user still exists in the database and is active.
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      res.status(401).json({ error: { code: 'USER_NOT_FOUND', message: 'User account no longer exists' } });
      return;
    }

    if (user.status === 'BANNED') {
      res.status(403).json({
        error: {
          code: 'ACCOUNT_BANNED',
          message: user.statusReason ? `Account banned: ${user.statusReason}` : 'This account has been permanently banned.',
        },
      });
      return;
    }

    if (user.status === 'DEACTIVATED') {
      res.status(403).json({
        error: {
          code: 'ACCOUNT_DEACTIVATED',
          message: 'This account has been deactivated. Please contact support.',
        },
      });
      return;
    }

    if (payload.tokenVersion !== undefined && payload.tokenVersion !== user.tokenVersion) {
      res.status(401).json({ error: { code: 'SESSION_REVOKED', message: 'Session has been invalidated. Please log in again.' } });
      return;
    }

    req.user = payload;
    const clientTimezone = req.headers['x-client-timezone'];
    if (typeof clientTimezone === 'string' && clientTimezone.trim()) {
      try {
        await prisma.user.updateMany({
          where: { id: payload.sub },
          data: { timezone: clientTimezone.trim() },
        });
      } catch (err) {
        console.warn('Timezone sync skipped:', err);
      }
    }
    next();
  } catch {
    res.status(401).json({ error: { code: 'TOKEN_EXPIRED', message: 'Access token is expired or invalid' } });
  }
}

