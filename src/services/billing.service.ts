// backend/src/services/billing.service.ts
// Handles orders, invoices, transactions ledger, refunds, and webhook processing.

import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import { createRazorpayOrder, createRazorpayRefund, verifyRazorpayPaymentSignature } from '../providers/razorpay/razorpay.payment';
import { verifyRazorpayWebhookSignature } from '../providers/razorpay/razorpay.webhook';
import { validateCoupon, redeemCouponAtomic } from './coupon.service';
import { recordSubscriptionEvent } from './subscription.service';
import { logAdminAction } from './audit.service';
import type { PaymentOrderType, BillingTransactionType, PaymentStatus, Prisma } from '@prisma/client';

export async function createCheckoutOrder(params: {
  userId: string;
  planId: string;
  type?: PaymentOrderType;
  couponCode?: string;
  idempotencyKey?: string;
}) {
  const plan = await prisma.plan.findUnique({ where: { id: params.planId } });
  if (!plan || !plan.isActive) {
    throw createError(400, 'INVALID_PLAN', 'Selected plan is not available');
  }

  let subtotalCents = plan.priceCents;
  let discountCents = 0;
  let couponId: string | null = null;

  if (params.couponCode?.trim()) {
    const validated = await validateCoupon({
      code: params.couponCode,
      userId: params.userId,
      planId: plan.id,
      subtotalCents,
    });
    discountCents = validated.discountCents;
    couponId = validated.coupon.id;
  }

  const totalCents = Math.max(0, subtotalCents - discountCents);
  const type = params.type || 'ONE_TIME';
  const currency = plan.currency;

  // A fully discounted bill (₹0) requires no charge, so we must NOT create a
  // Razorpay order — Razorpay rejects zero-amount orders (which surfaces as a
  // broken checkout / login prompt in test mode). Instead we synthesize an
  // order id and let the paymentOrder record the zero-amount grant.
  const noPaymentRequired = totalCents <= 0;

  let rzpOrderId: string;
  if (noPaymentRequired) {
    rzpOrderId = `free_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  } else {
    // Create Razorpay Order
    const rzpOrder = await createRazorpayOrder({
      amountCents: totalCents,
      currency,
      receipt: `rcpt_${Date.now()}`,
      notes: {
        userId: params.userId,
        planId: plan.id,
        couponId: couponId || undefined,
      },
    });
    rzpOrderId = rzpOrder.id;
  }

  const order = await prisma.paymentOrder.create({
    data: {
      userId: params.userId,
      planId: plan.id,
      type,
      provider: 'razorpay',
      providerOrderId: rzpOrderId,
      currency,
      subtotalCents,
      discountCents,
      taxCents: 0,
      totalCents,
      status: 'CREATED',
      couponId,
      idempotencyKey: params.idempotencyKey || null,
      metadata: {
        planName: plan.name,
        planSlug: plan.slug,
        priceCents: plan.priceCents,
        billingInterval: plan.billingInterval,
      },
    },
    include: { plan: true },
  });

  return {
    orderId: order.id,
    providerOrderId: order.providerOrderId,
    amountCents: order.totalCents,
    currency: order.currency,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    noPaymentRequired,
    keyId: noPaymentRequired ? undefined : process.env.RAZORPAY_KEY_ID,
  };
}

export async function recordSuccessfulPayment(params: {
  userId: string;
  provider: string;
  providerPaymentId: string;
  providerOrderId?: string;
  providerSubscriptionId?: string;
  amountCents: number;
  currency: string;
  orderId?: string;
  subscriptionId?: string;
  planId?: string;
  couponId?: string;
  discountCents?: number;
  metadata?: any;
}) {
  // Idempotency: Check if transaction already recorded
  const existingTx = await prisma.billingTransaction.findUnique({
    where: {
      provider_providerPaymentId: {
        provider: params.provider,
        providerPaymentId: params.providerPaymentId,
      },
    },
  });

  if (existingTx) {
    return existingTx;
  }

  return prisma.$transaction(async (tx) => {
    // Generate sequential invoice number: INV-YEAR-RANDOM
    const year = new Date().getFullYear();
    const invoiceNumber = `INV-${year}-${Math.floor(100000 + Math.random() * 900000)}`;

    const discountCents = params.discountCents || 0;
    const grossAmountCents = params.amountCents + discountCents;
    const netAmountCents = params.amountCents;

    const invoice = await tx.invoice.create({
      data: {
        userId: params.userId,
        subscriptionId: params.subscriptionId || null,
        orderId: params.orderId || null,
        provider: params.provider,
        invoiceNumber,
        status: 'PAID',
        currency: params.currency,
        subtotalCents: grossAmountCents,
        discountCents,
        taxCents: 0,
        totalCents: netAmountCents,
        paidAt: new Date(),
      },
    });

    const transaction = await tx.billingTransaction.create({
      data: {
        userId: params.userId,
        subscriptionId: params.subscriptionId || null,
        orderId: params.orderId || null,
        invoiceId: invoice.id,
        planId: params.planId || null,
        couponId: params.couponId || null,
        provider: params.provider,
        providerPaymentId: params.providerPaymentId,
        providerOrderId: params.providerOrderId || null,
        providerSubscriptionId: params.providerSubscriptionId || null,
        transactionType: params.subscriptionId ? 'SUBSCRIPTION_INITIAL' : 'PAYMENT',
        status: 'CAPTURED',
        currency: params.currency,
        grossAmountCents,
        discountCents,
        taxCents: 0,
        netAmountCents,
        paidAt: new Date(),
        metadata: params.metadata || undefined,
      },
    });

    if (params.orderId) {
      await tx.paymentOrder.update({
        where: { id: params.orderId },
        data: { status: 'CAPTURED' },
      });
    }

    if (params.couponId) {
      await redeemCouponAtomic(
        {
          couponId: params.couponId,
          userId: params.userId,
          orderId: params.orderId,
          transactionId: transaction.id,
          discountCents,
        },
        tx
      );
    }

    return transaction;
  });
}

export async function processRazorpayWebhook(rawBody: string, signature: string | undefined) {
  const isValid = verifyRazorpayWebhookSignature(rawBody, signature);
  if (!isValid) {
    throw createError(400, 'INVALID_SIGNATURE', 'Razorpay webhook signature verification failed.');
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw createError(400, 'MALFORMED_JSON', 'Failed to parse webhook JSON body.');
  }

  const providerEventId = event.event_id || event.id || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const eventType = event.event;

  // Idempotency: Store the event before processing
  const existingEvent = await prisma.paymentWebhookEvent.findUnique({
    where: {
      provider_providerEventId: {
        provider: 'razorpay',
        providerEventId,
      },
    },
  });

  if (existingEvent && existingEvent.processingStatus === 'PROCESSED') {
    return { status: 'ALREADY_PROCESSED', eventId: providerEventId };
  }

  const webhookRecord =
    existingEvent ||
    (await prisma.paymentWebhookEvent.create({
      data: {
        provider: 'razorpay',
        providerEventId,
        eventType,
        payload: event,
        signature: signature || '',
        processingStatus: 'PROCESSING',
      },
    }));

  try {
    // Process according to event type
    switch (eventType) {
      case 'payment.captured': {
        const payment = event.payload?.payment?.entity;
        if (payment) {
          const notes = payment.notes || {};
          let order = null;
          if (payment.order_id) {
            order = await prisma.paymentOrder.findFirst({
              where: { providerOrderId: payment.order_id },
            });
          }

          const userId = notes.userId || order?.userId;
          if (userId) {
            await recordSuccessfulPayment({
              userId,
              provider: 'razorpay',
              providerPaymentId: payment.id,
              providerOrderId: payment.order_id,
              amountCents: payment.amount,
              currency: payment.currency,
              orderId: order?.id,
              planId: notes.planId || order?.planId,
              couponId: notes.couponId || order?.couponId,
              discountCents: order?.discountCents || 0,
              metadata: {
                paymentMethod: payment.method,
                email: payment.email,
                contact: payment.contact,
              },
            });
          }
        }
        break;
      }

      case 'subscription.activated':
      case 'subscription.charged': {
        const subEntity = event.payload?.subscription?.entity;
        const paymentEntity = event.payload?.payment?.entity;
        if (subEntity) {
          const sub = await prisma.subscription.findUnique({
            where: {
              provider_providerSubscriptionId: {
                provider: 'razorpay',
                providerSubscriptionId: subEntity.id,
              },
            },
            include: { plan: true },
          });

          if (sub) {
            const nextEnd = subEntity.current_end
              ? new Date(subEntity.current_end * 1000)
              : new Date(Date.now() + 30 * 86400 * 1000);

            await prisma.subscription.update({
              where: { id: sub.id },
              data: {
                status: 'ACTIVE',
                currentPeriodEnd: nextEnd,
              },
            });

            await recordSubscriptionEvent({
              subscriptionId: sub.id,
              eventType: eventType === 'subscription.activated' ? 'ACTIVATED' : 'CHARGED',
              provider: 'razorpay',
              providerEventId,
              payload: subEntity,
            });

            if (paymentEntity) {
              await recordSuccessfulPayment({
                userId: sub.userId,
                provider: 'razorpay',
                providerPaymentId: paymentEntity.id,
                providerSubscriptionId: subEntity.id,
                amountCents: paymentEntity.amount,
                currency: paymentEntity.currency,
                subscriptionId: sub.id,
                planId: sub.planId,
                metadata: {
                  planName: sub.plan.name,
                  billingInterval: sub.billingInterval,
                },
              });
            }
          }
        }
        break;
      }

      case 'subscription.cancelled': {
        const subEntity = event.payload?.subscription?.entity;
        if (subEntity) {
          const sub = await prisma.subscription.findUnique({
            where: {
              provider_providerSubscriptionId: {
                provider: 'razorpay',
                providerSubscriptionId: subEntity.id,
              },
            },
          });
          if (sub) {
            await prisma.subscription.update({
              where: { id: sub.id },
              data: { status: 'CANCELLED', endedAt: new Date() },
            });
            await recordSubscriptionEvent({
              subscriptionId: sub.id,
              eventType: 'CANCELLED',
              provider: 'razorpay',
              providerEventId,
              payload: subEntity,
            });
          }
        }
        break;
      }

      case 'refund.processed': {
        const refundEntity = event.payload?.refund?.entity;
        if (refundEntity) {
          await prisma.refund.updateMany({
            where: {
              provider: 'razorpay',
              providerRefundId: refundEntity.id,
            },
            data: {
              status: 'PROCESSED',
              processedAt: new Date(),
            },
          });
        }
        break;
      }
    }

    await prisma.paymentWebhookEvent.update({
      where: { id: webhookRecord.id },
      data: {
        processingStatus: 'PROCESSED',
        processedAt: new Date(),
      },
    });

    return { status: 'PROCESSED', eventId: providerEventId };
  } catch (err: any) {
    await prisma.paymentWebhookEvent.update({
      where: { id: webhookRecord.id },
      data: {
        processingStatus: 'FAILED',
        processingAttempts: { increment: 1 },
        lastError: err.message,
      },
    });
    throw err;
  }
}

export async function processRefund(params: {
  transactionId: string;
  amountCents?: number;
  reason: string;
  adminAccountId: string;
}) {
  const transaction = await prisma.billingTransaction.findUnique({
    where: { id: params.transactionId },
    include: { refunds: true },
  });

  if (!transaction) throw createError(404, 'TRANSACTION_NOT_FOUND', 'Transaction not found');
  if (transaction.status !== 'CAPTURED') {
    throw createError(400, 'INVALID_TX_STATUS', 'Only captured payments can be refunded');
  }

  const alreadyRefundedCents = transaction.refunds
    .filter((r) => r.status === 'PROCESSED')
    .reduce((acc, r) => acc + r.amountCents, 0);

  const refundAmount = params.amountCents || transaction.netAmountCents - alreadyRefundedCents;
  if (refundAmount <= 0) {
    throw createError(400, 'INVALID_REFUND_AMOUNT', 'Transaction has already been fully refunded');
  }

  if (alreadyRefundedCents + refundAmount > transaction.netAmountCents) {
    throw createError(400, 'EXCEEDS_NET_AMOUNT', 'Refund amount exceeds remaining captured balance');
  }

  // Call Razorpay Refund API
  let rzpRefund;
  if (transaction.providerPaymentId) {
    rzpRefund = await createRazorpayRefund({
      paymentId: transaction.providerPaymentId,
      amountCents: refundAmount,
      notes: { reason: params.reason, adminId: params.adminAccountId },
    });
  }

  const refund = await prisma.refund.create({
    data: {
      transactionId: transaction.id,
      userId: transaction.userId,
      provider: transaction.provider,
      providerRefundId: rzpRefund?.id || `rfnd_${Date.now()}`,
      amountCents: refundAmount,
      currency: transaction.currency,
      status: 'PROCESSED',
      reason: params.reason,
      initiatedByAdminId: params.adminAccountId,
      processedAt: new Date(),
    },
  });

  const totalRefundedNow = alreadyRefundedCents + refundAmount;
  const newStatus: PaymentStatus =
    totalRefundedNow >= transaction.netAmountCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

  await prisma.billingTransaction.update({
    where: { id: transaction.id },
    data: { status: newStatus },
  });

  await logAdminAction({
    adminAccountId: params.adminAccountId,
    action: 'REFUND_PROCESSED',
    entityType: 'Refund',
    entityId: refund.id,
    after: refund,
    reason: params.reason,
  });

  return refund;
}

export async function listAdminTransactions(params?: {
  page?: number;
  pageSize?: number;
  status?: PaymentStatus;
  search?: string;
  startDate?: string;
  endDate?: string;
}) {
  const page = Math.max(1, params?.page || 1);
  const pageSize = Math.min(100, Math.max(1, params?.pageSize || 20));
  const skip = (page - 1) * pageSize;

  const where: Prisma.BillingTransactionWhereInput = {};
  if (params?.status) where.status = params.status;
  if (params?.search?.trim()) {
    const q = params.search.trim();
    where.OR = [
      { user: { email: { contains: q, mode: 'insensitive' } } },
      { providerPaymentId: { contains: q } },
      { providerOrderId: { contains: q } },
      { providerSubscriptionId: { contains: q } },
    ];
  }
  if (params?.startDate || params?.endDate) {
    where.createdAt = {};
    if (params?.startDate) where.createdAt.gte = new Date(params.startDate);
    if (params?.endDate) where.createdAt.lte = new Date(params.endDate);
  }

  const [totalCount, items] = await Promise.all([
    prisma.billingTransaction.count({ where }),
    prisma.billingTransaction.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, email: true, name: true } },
        plan: true,
        refunds: true,
      },
    }),
  ]);

  return {
    items,
    pagination: {
      page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
    },
  };
}

export async function getTransactionDetail(id: string) {
  const tx = await prisma.billingTransaction.findUnique({
    where: { id },
    include: {
      user: true,
      plan: true,
      refunds: true,
      invoice: true,
      subscription: { include: { events: true } },
    },
  });
  if (!tx) throw createError(404, 'TRANSACTION_NOT_FOUND', 'Transaction not found');
  return tx;
}