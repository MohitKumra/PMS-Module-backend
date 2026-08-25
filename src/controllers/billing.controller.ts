// backend/src/controllers/billing.controller.ts
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import { listPlans, getPlanById } from '../services/plan.service';
import { resolveEffectivePlan } from '../services/entitlement.service';
import {
  createCheckoutOrder,
  recordSuccessfulPayment,
} from '../services/billing.service';
import { cancelSubscriptionAction as cancelSubscriptionService } from '../services/subscription.service';
import { validateCoupon } from '../services/coupon.service';
import { verifyRazorpayPaymentSignature } from '../providers/razorpay/razorpay.payment';

/**
 * GET /api/billing/plans
 * Public/authenticated endpoint to list all available active plans.
 */
export async function getPublicPlans(_req: Request, res: Response, next: NextFunction) {
  try {
    const plans = await listPlans(false);
    return res.json({ data: plans });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/billing/subscription
 * Authenticated endpoint returning current user's effective plan, entitlements,
 * current resource usage counts, active subscription, and billing history.
 */
export async function getUserSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.sub || (req.user as any)!.id;
    const effectivePlan = await resolveEffectivePlan(userId);

    // Active subscription if any
    const activeSub = await prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ['ACTIVE', 'PAST_DUE', 'PAUSED'] },
      },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });

    const [projectsCount, habitsCount, tasksCount, aiUsageCount] = await Promise.all([
      prisma.project.count({ where: { userId } }),
      prisma.habit.count({ where: { userId } }),
      prisma.task.count({ where: { userId } }),
      prisma.aIPreference
        .findUnique({ where: { userId } })
        .then((p) => p?.aiRequestsThisMonth ?? 0),
    ]);

    // Recent billing transactions
    const transactions = await prisma.billingTransaction.findMany({
      where: { userId },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return res.json({
      data: {
        effectivePlan,
        subscription: activeSub,
        usage: {
          projects: projectsCount,
          habits: habitsCount,
          tasks: tasksCount,
          aiRequests: aiUsageCount,
        },
        transactions,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/billing/apply-coupon
 * Validates a coupon code for a chosen plan and calculates discount preview.
 */
export async function previewCoupon(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.sub || (req.user as any)!.id;
    const { code, planId } = req.body;

    if (!code || !planId) {
      throw createError(400, 'MISSING_FIELDS', 'Coupon code and plan ID are required.');
    }

    const plan = await getPlanById(planId);
    const result = await validateCoupon({
      code,
      userId,
      planId: plan.id,
      subtotalCents: plan.priceCents,
    });

    return res.json({
      data: {
        isValid: true,
        couponCode: result.coupon.code,
        discountType: result.coupon.discountType,
        discountValue: result.coupon.discountValue,
        discountCents: result.discountCents,
        finalAmountCents: Math.max(0, plan.priceCents - result.discountCents),
        currency: plan.currency,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/billing/checkout
 * Initiates Razorpay checkout order with optional coupon.
 */
export async function createCheckout(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.sub || (req.user as any)!.id;
    const { planId, couponCode, idempotencyKey } = req.body;

    if (!planId) {
      throw createError(400, 'MISSING_PLAN_ID', 'Plan ID is required.');
    }

    const checkoutData = await createCheckoutOrder({
      userId,
      planId,
      couponCode,
      idempotencyKey,
    });

    return res.json({ data: checkoutData });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/billing/verify-payment
 * Verifies Razorpay payment signature and activates the user's plan.
 */
export async function verifyPayment(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.sub || (req.user as any)!.id;
    const {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      orderId,
    } = req.body;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      throw createError(400, 'INVALID_PAYMENT_PAYLOAD', 'Missing Razorpay payment identifiers.');
    }

    const isValid = verifyRazorpayPaymentSignature({
      orderId: razorpayOrderId,
      paymentId: razorpayPaymentId,
      signature: razorpaySignature,
    });

    if (!isValid) {
      throw createError(400, 'SIGNATURE_VERIFICATION_FAILED', 'Payment signature could not be verified.');
    }

    // Find the payment order
    const order = await prisma.paymentOrder.findFirst({
      where: {
        providerOrderId: razorpayOrderId,
        userId,
      },
      include: { plan: true },
    });

    if (!order) {
      throw createError(404, 'ORDER_NOT_FOUND', 'Matching payment order was not found.');
    }

    // Record successful payment and activate subscription/plan
    const tx = await recordSuccessfulPayment({
      userId,
      provider: 'razorpay',
      providerPaymentId: razorpayPaymentId,
      providerOrderId: razorpayOrderId,
      amountCents: order.totalCents,
      currency: order.currency,
      orderId: order.id,
      planId: order.planId || undefined,
      couponId: order.couponId || undefined,
      metadata: {
        verifiedVia: 'CLIENT_CHECKOUT_VERIFICATION',
      },
    });

    // Fetch updated effective plan
    const effectivePlan = await resolveEffectivePlan(userId);

    return res.json({
      data: {
        success: true,
        transactionId: tx.id,
        effectivePlan,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/billing/cancel-subscription
 * Cancels user's active recurring subscription.
 */
export async function cancelSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.sub || (req.user as any)!.id;
    const { immediately } = req.body;

    const sub = await prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ['ACTIVE', 'PAST_DUE'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!sub) {
      throw createError(404, 'NO_ACTIVE_SUBSCRIPTION', 'No active subscription found to cancel.');
    }

    const updated = await cancelSubscriptionService(
      sub.id,
      !Boolean(immediately)
      );

    return res.json({
      data: {
        success: true,
        subscription: updated,
      },
    });
  } catch (err) {
    next(err);
  }
}
