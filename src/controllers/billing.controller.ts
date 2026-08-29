// backend/src/controllers/billing.controller.ts
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import { listPlans, getPlanById } from '../services/plan.service';
import { resolveEffectivePlan } from '../services/entitlement.service';
import { getUserStorageUsedBytes, getUserStorageLimitBytes } from '../services/storage.service';
import {
  createCheckoutOrder,
  recordSuccessfulPayment,
  listUserInvoices,
  getUserInvoice,
} from '../services/billing.service';
import { buildInvoicePdfBuffer } from '../services/billingDocuments.service';
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

    const [projectsCount, habitsCount, tasksCount, aiUsageCount, notesCount, journalsCount, storageUsedBytes, storageLimitBytes] = await Promise.all([
      prisma.project.count({ where: { userId } }),
      prisma.habit.count({ where: { userId } }),
      prisma.task.count({ where: { userId } }),
      prisma.aIPreference
        .findUnique({ where: { userId } })
        .then((p) => p?.aiRequestsThisMonth ?? 0),
      prisma.note.count({ where: { userId, isJournal: false, archived: false } }),
      prisma.note.count({ where: { userId, isJournal: true, archived: false } }),
      getUserStorageUsedBytes(userId),
      getUserStorageLimitBytes(userId),
    ]);

    // Recent billing transactions
    const transactions = await prisma.billingTransaction.findMany({
      where: { userId },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const invoices = await listUserInvoices(userId);

    return res.json({
      data: {
        effectivePlan,
        subscription: activeSub,
        usage: {
          projects: projectsCount,
          habits: habitsCount,
          tasks: tasksCount,
          aiRequests: aiUsageCount,
          notes: notesCount,
          journals: journalsCount,
          storageUsedBytes,
          storageLimitBytes,
        },
        transactions,
        invoices,
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
    const { planId, couponCode, idempotencyKey, type } = req.body;

    if (!planId) {
      throw createError(400, 'MISSING_PLAN_ID', 'Plan ID is required.');
    }

    // Users may pay once or opt into recurring auto-pay. Validate the allowed
    // set explicitly (never trust arbitrary input).
    const paymentType: 'ONE_TIME' | 'SUBSCRIPTION_INITIAL' =
      type === 'SUBSCRIPTION_INITIAL' ? 'SUBSCRIPTION_INITIAL' : 'ONE_TIME';

    const checkoutData = await createCheckoutOrder({
      userId,
      planId,
      couponCode,
      idempotencyKey,
      type: paymentType,
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
      subtotalCents: order.subtotalCents,
      autoRenew: order.type === 'SUBSCRIPTION_INITIAL',
      taxCents: order.taxCents,
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

/**
 * GET /api/billing/invoices/:id/pdf
 * Streams a PDF invoice for the signed-in user.
 */
export async function getInvoicePdf(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.sub || (req.user as any)!.id;
    const invoiceId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const invoice = await getUserInvoice(userId, invoiceId);
    const pdf = buildInvoicePdfBuffer({
      userId,
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        currency: invoice.currency,
        subtotalCents: invoice.subtotalCents,
        discountCents: invoice.discountCents,
        taxCents: invoice.taxCents,
        totalCents: invoice.totalCents,
        issuedAt: invoice.issuedAt,
        paidAt: invoice.paidAt,
        dueAt: invoice.dueAt,
        pdfUrl: invoice.pdfUrl,
      },
      user: invoice.user,
      planName:
        invoice.subscription?.plan?.name ||
        ((invoice.order?.metadata as any)?.planName as string | undefined) ||
        undefined,
      planSlug: invoice.subscription?.plan?.slug || undefined,
      subscriptionId: invoice.subscriptionId || null,
      transactionId: invoice.transactions?.[0]?.id || null,
      providerPaymentId: invoice.transactions?.[0]?.providerPaymentId || null,
      providerOrderId: invoice.orderId || null,
      providerSubscriptionId: invoice.subscription?.providerSubscriptionId || null,
      autoRenew: invoice.subscription?.autoRenew ?? null,
      billingInterval: invoice.subscription?.billingInterval || undefined,
    });

    const downloadValue = Array.isArray(req.query.download)
      ? req.query.download[0]
      : req.query.download;
    const download = String(downloadValue || '') === '1';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="invoice-${invoice.invoiceNumber}.pdf"`
    );
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.send(pdf);
  } catch (err) {
    next(err);
  }
}
