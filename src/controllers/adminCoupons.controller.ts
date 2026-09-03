// backend/src/controllers/adminCoupons.controller.ts
// Administration endpoints for coupons and discounts.

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { listCoupons, getCouponById, createCoupon, updateCoupon, validateCoupon, deleteCoupon } from '../services/coupon.service';

const createCouponSchema = z.object({
  code: z.string().min(2).max(30),
  description: z.string().optional(),
  type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT']),
  value: z.number().int().positive(),
  currency: z.string().default('USD'),
  maxUses: z.number().int().positive().optional(),
  perUserLimit: z.number().int().positive().optional(),
  minimumAmountCents: z.number().int().nonnegative().optional(),
  startsAt: z.string().optional(),
  expiresAt: z.string().optional(),
  isActive: z.boolean().optional(),
  appliesToAllPlans: z.boolean().optional(),
  targetPlanIds: z.array(z.string()).optional(),
});

const updateCouponSchema = z.object({
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  maxUses: z.number().int().positive().optional(),
  perUserLimit: z.number().int().positive().optional(),
  minimumAmountCents: z.number().int().nonnegative().optional(),
  startsAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  appliesToAllPlans: z.boolean().optional(),
  targetPlanIds: z.array(z.string()).optional(),
});

const validateCouponSchema = z.object({
  code: z.string().min(1),
  planId: z.string().optional(),
  subtotalCents: z.number().int().nonnegative(),
});

export async function listCouponsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 20;
    const search = req.query.search as string | undefined;
    const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined;

    const result = await listCoupons({ page, pageSize, search, isActive });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function getCouponDetailHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const coupon = await getCouponById(id);
    res.json({ success: true, data: coupon });
  } catch (err) {
    next(err);
  }
}

export async function createCouponHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = createCouponSchema.parse(req.body);
    const coupon = await createCoupon({
      ...data,
      adminAccountId: req.admin?.sub,
    });
    res.status(201).json({ success: true, message: 'Coupon created successfully', data: coupon });
  } catch (err) {
    next(err);
  }
}

export async function updateCouponHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const data = updateCouponSchema.parse(req.body);
    const coupon = await updateCoupon(id, {
      ...data,
      adminAccountId: req.admin?.sub,
    });
    res.json({ success: true, message: 'Coupon updated successfully', data: coupon });
  } catch (err) {
    next(err);
  }
}

export async function validateCouponHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { code, planId, subtotalCents } = validateCouponSchema.parse(req.body);
    const userId = req.user?.sub || req.body.userId || 'guest';
    const result = await validateCoupon({
      code,
      userId,
      planId,
      subtotalCents,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function deleteCouponHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const result = await deleteCoupon(id, req.admin?.sub);
    res.json(result);
  } catch (err) {
    next(err);
  }
}