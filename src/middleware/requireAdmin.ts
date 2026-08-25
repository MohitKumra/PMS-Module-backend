// backend/src/middleware/requireAdmin.ts
// Verifies isolated Admin JWT and ensures the admin account is active.

import type { Request, Response, NextFunction } from 'express';
import type { AdminRole } from '@prisma/client';
import { verifyAdminAccessToken, type AdminJwtPayload } from '../lib/adminJwt';
import { prisma } from '../lib/prismaClient';

declare global {
  namespace Express {
    interface Request {
      admin?: AdminJwtPayload;
    }
  }
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'];
  let token: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (req.cookies?.adminAccessToken) {
    token = req.cookies.adminAccessToken;
  }

  if (!token) {
    res.status(401).json({
      error: { code: 'ADMIN_UNAUTHORIZED', message: 'Admin authentication required' },
    });
    return;
  }

  try {
    const payload = verifyAdminAccessToken(token);
    const admin = await prisma.adminAccount.findUnique({
      where: { id: payload.sub },
    });

    if (!admin) {
      res.status(401).json({
        error: { code: 'ADMIN_NOT_FOUND', message: 'Admin account not found' },
      });
      return;
    }

    if (!admin.isActive) {
      res.status(403).json({
        error: { code: 'ADMIN_DEACTIVATED', message: 'Admin account has been deactivated' },
      });
      return;
    }

    req.admin = {
      sub: admin.id,
      email: admin.email,
      role: admin.role,
    };

    next();
  } catch {
    res.status(401).json({
      error: { code: 'ADMIN_TOKEN_INVALID', message: 'Admin session is invalid or expired' },
    });
  }
}