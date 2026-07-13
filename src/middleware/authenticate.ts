// backend/src/middleware/authenticate.ts
// JWT authentication middleware.
// Reads the Bearer token from the Authorization header, verifies it,
// and attaches the decoded payload as `req.user` for downstream handlers.
// Responds 401 if the token is missing, malformed, or expired.

import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JwtPayload } from '../lib/jwt';
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
    req.user = payload;
    const clientTimezone = req.headers['x-client-timezone'];
    if (typeof clientTimezone === 'string' && clientTimezone.trim()) {
      try {
        await prisma.user.update({
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
