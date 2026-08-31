// backend/src/controllers/customPlan.controller.ts
// User-facing endpoints for Custom Plan requests (self-service creation + history).

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  createCustomPlanRequest,
  listMyCustomPlanRequests,
  getMyCustomPlanRequest,
  getCustomPlanPay,
  createCustomPlanPaymentOrder,
  verifyCustomPlanPayment,
} from '../services/customPlan.service';

const createSchema = z.object({
  requestedFeatures: z.record(z.any()).optional(),
  requestedLimits: z.record(z.any()).optional(),
  requirements: z.record(z.any()).optional(),
});

const verifyPaymentSchema = z.object({
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

export async function createCustomPlanRequestHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.sub;
    const payload = createSchema.parse(req.body || {});
    const request = await createCustomPlanRequest(userId, payload);
    res.status(201).json({ data: request });
  } catch (err) {
    next(err);
  }
}

export async function listMyCustomPlanRequestsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.sub;
    const requests = await listMyCustomPlanRequests(userId);
    res.json({ data: requests });
  } catch (err) {
    next(err);
  }
}

export async function getMyCustomPlanRequestHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.sub;
    const id = req.params.id as string;
    const request = await getMyCustomPlanRequest(userId, id);
    res.json({ data: request });
  } catch (err) {
    next(err);
  }
}

export async function getCustomPlanPayHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.sub;
    const token = req.params.token as string;
    const info = await getCustomPlanPay(token, userId);
    res.json({ data: info });
  } catch (err) {
    next(err);
  }
}

export async function createCustomPlanPaymentOrderHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.sub;
    const token = req.params.token as string;
    const checkout = await createCustomPlanPaymentOrder(token, userId);
    res.json({ data: checkout });
  } catch (err) {
    next(err);
  }
}

export async function verifyCustomPlanPaymentHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.sub;
    const token = req.params.token as string;
    const verification = verifyPaymentSchema.parse(req.body || {});
    const tx = await verifyCustomPlanPayment(token, userId, verification);
    res.json({ data: { success: true, transactionId: tx.id } });
  } catch (err) {
    next(err);
  }
}