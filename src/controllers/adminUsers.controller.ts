// backend/src/controllers/adminUsers.controller.ts
// Administration endpoints for user management.

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  listAdminUsers,
  getAdminUserDetail,
  deactivateUser,
  reactivateUser,
  banUser,
  grantEntitlementOverride,
  revokeEntitlementOverride,
} from '../services/adminUser.service';

const reasonSchema = z.object({
  reason: z.string().optional(),
});

const banSchema = z.object({
  reason: z.string().min(1, 'Reason is required for permanent ban'),
});

const overrideSchema = z.object({
  planId: z.string().min(1),
  durationDays: z.number().int().positive().optional(),
  reason: z.string().min(1),
});

export async function listUsersHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 20;
    const search = req.query.search as string | undefined;
    const status = req.query.status as any;
    const authProvider = req.query.authProvider as any;
    const planSlug = req.query.planSlug as string | undefined;
    const subscriptionStatus = req.query.subscriptionStatus as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const sortBy = req.query.sortBy as any;
    const sortOrder = req.query.sortOrder as any;

    const result = await listAdminUsers({
      page,
      pageSize,
      search,
      status,
      authProvider,
      planSlug,
      subscriptionStatus,
      startDate,
      endDate,
      sortBy,
      sortOrder,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function getUserDetailHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const user = await getAdminUserDetail(id);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

export async function deactivateUserHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const { reason } = reasonSchema.parse(req.body);
    const updated = await deactivateUser(id, req.admin!.sub, reason);
    res.json({
      success: true,
      message: 'User deactivated successfully',
      data: { id: updated.id, status: updated.status },
    });
  } catch (err) {
    next(err);
  }
}

export async function reactivateUserHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const { reason } = reasonSchema.parse(req.body);
    const updated = await reactivateUser(id, req.admin!.sub, reason);
    res.json({
      success: true,
      message: 'User reactivated successfully',
      data: { id: updated.id, status: updated.status },
    });
  } catch (err) {
    next(err);
  }
}

export async function banUserHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const { reason } = banSchema.parse(req.body);
    const updated = await banUser(id, req.admin!.sub, reason);
    res.json({
      success: true,
      message: 'User permanently banned',
      data: { id: updated.id, status: updated.status },
    });
  } catch (err) {
    next(err);
  }
}

export async function overrideEntitlementHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const { planId, durationDays, reason } = overrideSchema.parse(req.body);
    const override = await grantEntitlementOverride({
      userId: id,
      planId,
      durationDays,
      reason,
      adminAccountId: req.admin!.sub,
    });
    res.json({ success: true, message: 'Entitlement override granted', data: override });
  } catch (err) {
    next(err);
  }
}

export async function revokeEntitlementHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const overrideId = req.params.overrideId as string;
    const { reason } = reasonSchema.parse(req.body);
    const override = await revokeEntitlementOverride(overrideId, req.admin!.sub, reason);
    res.json({ success: true, message: 'Entitlement override revoked', data: override });
  } catch (err) {
    next(err);
  }
}