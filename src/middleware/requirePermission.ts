// backend/src/middleware/requirePermission.ts
// Role-based access control (RBAC) middleware for administrative capabilities.

import type { Request, Response, NextFunction } from 'express';
import type { AdminRole } from '@prisma/client';

export type AdminPermission =
  | 'users.read'
  | 'users.deactivate'
  | 'users.ban'
  | 'billing.read'
  | 'billing.refund'
  | 'plans.read'
  | 'plans.write'
  | 'coupons.read'
  | 'coupons.write'
  | 'analytics.read'
  | 'audit.read'
  | 'admins.manage'
  | 'system.read';

export const ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  SUPER_ADMIN: [
    'users.read',
    'users.deactivate',
    'users.ban',
    'billing.read',
    'billing.refund',
    'plans.read',
    'plans.write',
    'coupons.read',
    'coupons.write',
    'analytics.read',
    'audit.read',
    'admins.manage',
    'system.read',
  ],
  ADMIN: [
    'users.read',
    'users.deactivate',
    'users.ban',
    'billing.read',
    'billing.refund',
    'plans.read',
    'plans.write',
    'coupons.read',
    'coupons.write',
    'analytics.read',
    'audit.read',
    'system.read',
  ],
  SUPPORT: [
    'users.read',
    'users.deactivate',
    'billing.read',
    'plans.read',
    'coupons.read',
    'analytics.read',
    'system.read',
  ],
  BILLING: [
    'billing.read',
    'billing.refund',
    'plans.read',
    'coupons.read',
    'coupons.write',
    'analytics.read',
  ],
  ANALYST: [
    'users.read',
    'billing.read',
    'plans.read',
    'coupons.read',
    'analytics.read',
    'system.read',
  ],
};

export function hasPermission(role: AdminRole, permission: AdminPermission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function requirePermission(permission: AdminPermission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.admin) {
      res.status(401).json({
        error: { code: 'ADMIN_UNAUTHORIZED', message: 'Admin authentication required' },
      });
      return;
    }

    if (!hasPermission(req.admin.role, permission)) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN_PERMISSION',
          message: `Insufficient permissions. Required: ${permission}`,
        },
      });
      return;
    }

    next();
  };
}