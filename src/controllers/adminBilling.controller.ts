// backend/src/controllers/adminBilling.controller.ts
// Administration endpoints for subscriptions, financial ledger, refunds, and user checkout.

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  listAdminTransactions,
  getTransactionDetail,
  processRefund,
  createCheckoutOrder,
  recordSuccessfulPayment,
} from '../services/billing.service';
import {
  listSubscriptions,
  getSubscriptionDetail,
  cancelSubscriptionAction,
  pauseSubscriptionAction,
  resumeSubscriptionAction,
  initiateSubscription,
} from '../services/subscription.service';
import { verifyRazorpayPaymentSignature } from '../providers/razorpay/razorpay.payment';

const refundSchema = z.object({
  amountCents: z.number().int().positive().optional(),
  reason: z.string().min(1, 'Reason is required for refund'),
});

const checkoutSchema = z.object({
  planId: z.string().min(1),
  couponCode: z.string().optional(),
  type: z.enum(['ONE_TIME', 'SUBSCRIPTION_INITIAL']).default('ONE_TIME'),
});

const verifyPaymentSchema = z.object({
  orderId: z.string().min(1),
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
  planId: z.string().optional(),
  couponCode: z.string().optional(),
  amountCents: z.number().int().positive(),
  currency: z.string().default('USD'),
});

export async function listTransactionsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 20;
    const status = req.query.status as any;
    const search = req.query.search as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    const result = await listAdminTransactions({ page, pageSize, status, search, startDate, endDate });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function getTransactionDetailHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const tx = await getTransactionDetail(id);
    res.json({ success: true, data: tx });
  } catch (err) {
    next(err);
  }
}

export async function processRefundHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const { amountCents, reason } = refundSchema.parse(req.body);
    const refund = await processRefund({
      transactionId: id,
      amountCents,
      reason,
      adminAccountId: req.admin!.sub,
    });
    res.json({ success: true, message: 'Refund processed successfully', data: refund });
  } catch (err) {
    next(err);
  }
}

export async function listSubscriptionsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 20;
    const status = req.query.status as any;
    const search = req.query.search as string | undefined;

    const result = await listSubscriptions({ page, pageSize, status, search });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function getSubscriptionDetailHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const sub = await getSubscriptionDetail(id);
    res.json({ success: true, data: sub });
  } catch (err) {
    next(err);
  }
}

export async function cancelSubscriptionHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const cancelAtPeriodEnd = req.body.cancelAtPeriodEnd !== false;
    const sub = await cancelSubscriptionAction(id, cancelAtPeriodEnd);
    res.json({ success: true, message: 'Subscription cancelled', data: sub });
  } catch (err) {
    next(err);
  }
}

export async function pauseSubscriptionHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const sub = await pauseSubscriptionAction(id);
    res.json({ success: true, message: 'Subscription paused', data: sub });
  } catch (err) {
    next(err);
  }
}

export async function resumeSubscriptionHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const sub = await resumeSubscriptionAction(id);
    res.json({ success: true, message: 'Subscription resumed', data: sub });
  } catch (err) {
    next(err);
  }
}

// User-facing checkout endpoints
export async function createCheckoutHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.sub;
    const { planId, couponCode, type } = checkoutSchema.parse(req.body);

    if (type === 'SUBSCRIPTION_INITIAL') {
      const sub = await initiateSubscription({ userId, planId, provider: 'razorpay' });
      res.json({
        success: true,
        data: {
          subscriptionId: sub.id,
          providerSubscriptionId: sub.providerSubscriptionId,
          keyId: process.env.RAZORPAY_KEY_ID,
        },
      });
      return;
    }

    const order = await createCheckoutOrder({
      userId,
      planId,
      couponCode,
      type,
    });

    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
}

export async function verifyPaymentHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.sub;
    const data = verifyPaymentSchema.parse(req.body);

    const isValid = verifyRazorpayPaymentSignature({
      orderId: data.razorpayOrderId,
      paymentId: data.razorpayPaymentId,
      signature: data.razorpaySignature,
    });

    if (!isValid && !process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test_dummy')) {
      res.status(400).json({
        error: { code: 'INVALID_SIGNATURE', message: 'Payment verification failed' },
      });
      return;
    }

    const tx = await recordSuccessfulPayment({
      userId,
      provider: 'razorpay',
      providerPaymentId: data.razorpayPaymentId,
      providerOrderId: data.razorpayOrderId,
      amountCents: data.amountCents,
      currency: data.currency,
      orderId: data.orderId,
      planId: data.planId,
      subtotalCents: data.amountCents,
      discountCents: 0,
      taxCents: 0,
    });

    res.json({ success: true, message: 'Payment recorded successfully', data: tx });
  } catch (err) {
    next(err);
  }
}
