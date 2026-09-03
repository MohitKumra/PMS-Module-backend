// backend/src/controllers/adminPlans.controller.ts
// Handles admin plan creation, updates, and feature configurations.

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { listPlans, getPlanById, createPlan, updatePlan, deletePlan } from '../services/plan.service';

const createPlanSchema = z.object({
  slug: z.string().min(2).max(50),
  name: z.string().min(2).max(100),
  description: z.string().optional(),
  currency: z.string().default('USD'),
  priceCents: z.number().int().nonnegative(),
  gstPercent: z.number().int().min(0).max(100).default(18),
  billingInterval: z.enum(['MONTH', 'YEAR', 'ONE_TIME']).default('MONTH'),
  features: z.record(z.any()),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

const updatePlanSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().optional(),
  currency: z.string().optional(),
  priceCents: z.number().int().nonnegative().optional(),
  gstPercent: z.number().int().min(0).max(100).optional(),
  billingInterval: z.enum(['MONTH', 'YEAR', 'ONE_TIME']).optional(),
  features: z.record(z.any()).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export async function listPlansHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const plans = await listPlans(includeInactive);
    res.json({ success: true, data: plans });
  } catch (err) {
    next(err);
  }
}

export async function getPlanDetailHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const plan = await getPlanById(id);
    res.json({ success: true, data: plan });
  } catch (err) {
    next(err);
  }
}

export async function createPlanHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = createPlanSchema.parse(req.body);
    const plan = await createPlan({
      ...data,
      adminAccountId: req.admin?.sub,
    });
    res.status(201).json({ success: true, message: 'Plan created successfully', data: plan });
  } catch (err) {
    next(err);
  }
}

export async function updatePlanHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const data = updatePlanSchema.parse(req.body);
    const plan = await updatePlan(id, {
      ...data,
      adminAccountId: req.admin?.sub,
    });
    res.json({ success: true, message: 'Plan updated successfully', data: plan });
  } catch (err) {
    next(err);
  }
}

export async function deletePlanHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const result = await deletePlan(id, req.admin?.sub);
    res.json(result);
  } catch (err) {
    next(err);
  }
}