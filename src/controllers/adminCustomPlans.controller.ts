// backend/src/controllers/adminCustomPlans.controller.ts
// Administrative endpoints for reviewing, quoting, and managing Custom Plan
// requests. All routes are protected by requireAdmin + requirePermission.

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  listCustomPlanRequestsAdmin,
  getCustomPlanRequestAdmin,
  updateCustomPlanRequestAdmin,
  countOpenCustomPlanRequestsAdmin,
} from '../services/customPlan.service';
import { CUSTOM_PLAN_STATUSES } from '../services/customPlan.validation';

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  search: z.string().optional(),
  status: z.enum(['ALL', ...CUSTOM_PLAN_STATUSES]).optional(),
});

const updateSchema = z.object({
  status: z.enum(CUSTOM_PLAN_STATUSES).optional(),
  adminNotes: z.string().max(5000).nullable().optional(),
  quotedPriceCents: z.number().int().nonnegative().nullable().optional(),
  billingInterval: z.enum(['MONTH', 'YEAR']).optional(),
  finalConfig: z.record(z.any()).nullable().optional(),
});

export async function listCustomPlanRequestsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = listQuerySchema.parse(req.query);
    const result = await listCustomPlanRequestsAdmin({
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      status: query.status as any,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function countCustomPlanRequestsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const count = await countOpenCustomPlanRequestsAdmin();
    res.json({ success: true, data: { count } });
  } catch (err) {
    next(err);
  }
}

export async function getCustomPlanRequestHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = req.params.id as string;
    const request = await getCustomPlanRequestAdmin(id);
    res.json({ success: true, data: request });
  } catch (err) {
    next(err);
  }
}

export async function updateCustomPlanRequestHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = req.params.id as string;
    const payload = updateSchema.parse(req.body || {});
    const updated = await updateCustomPlanRequestAdmin(id, payload, req.admin!.sub);
    res.json({ success: true, message: 'Custom plan request updated', data: updated });
  } catch (err) {
    next(err);
  }
}