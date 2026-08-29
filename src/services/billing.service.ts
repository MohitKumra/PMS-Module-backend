// backend/src/services/billing.service.ts
// Handles orders, invoices, transactions ledger, refunds, and webhook processing.

import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import { createRazorpayOrder, createRazorpayRefund, verifyRazorpayPaymentSignature } from '../providers/razorpay/razorpay.payment';
import { verifyRazorpayWebhookSignature } from '../providers/razorpay/razorpay.webhook';
import { validateCoupon, redeemCouponAtomic } from './coupon.service';
import { recordSubscriptionEvent } from './subscription.service';
import { logAdminAction } from './audit.service';
import { sendNotification } from './notification.service';
import {
  buildBillingCustomerProfile,
  buildInvoiceEmailHtml,
  buildInvoicePdfBuffer,
  getBillingCompanyProfile,
  getInvoicePdfUrl,
  resolveGstBreakdownForNewInvoice,
  type BillingInvoiceDocument,
  type BillingCustomerProfile,
} from './billingDocuments.service';
import type { PaymentOrderType, BillingTransactionType, PaymentStatus, Prisma } from '@prisma/client';

function buildInvoiceDocument(params: {
  userId: string;
  invoice: {
    id: string;
    invoiceNumber: string;
    status: string;
    currency: string;
    subtotalCents: number;
    discountCents: number;
    taxCents: number;
    cgstCents: number;
    sgstCents: number;
    igstCents: number;
    sac?: string | null;
    placeOfSupply?: string | null;
    totalCents: number;
    issuedAt: Date;
    paidAt?: Date | null;
    dueAt?: Date | null;
    pdfUrl?: string | null;
  };
  user: {
    email: string;
    name?: string | null;
  };
  billingProfile?: BillingCustomerProfile | null;
  planName?: string | null;
  planSlug?: string | null;
  subscriptionId?: string | null;
  transactionId?: string | null;
  providerPaymentId?: string | null;
  providerOrderId?: string | null;
  providerSubscriptionId?: string | null;
  autoRenew?: boolean | null;
  billingInterval?: string | null;
  planEnd?: Date | null;
}): BillingInvoiceDocument {
  return params;
}

/** Compute the GST breakdown + SAC + place-of-supply snapshot for a new invoice,
 *  using the buyer's saved billing preference and the configured supplier
 *  location. This is persisted at transaction time so historical invoices keep
 *  their own snapshot and are never re-derived from later profile edits. */
async function resolveInvoiceTaxSnapshot(
  tx: any,
  userId: string,
  taxCents: number
): Promise<{
  cgstCents: number;
  sgstCents: number;
  igstCents: number;
  sac: string | null;
  placeOfSupply: string | null;
}> {
  const pref = await tx.userPreference.findUnique({ where: { userId } });
  const company = getBillingCompanyProfile();
  const split = resolveGstBreakdownForNewInvoice({
    taxCents,
    supplierPlaceOfSupply: company.placeOfSupply,
    buyerCityState: pref?.billingCityState ?? null,
    buyerGstin: pref?.billingGstin ?? null,
    buyerCountry: pref?.billingCountry ?? null,
  });
  return {
    cgstCents: split.cgstCents,
    sgstCents: split.sgstCents,
    igstCents: split.igstCents,
    sac: company.sac || null,
    placeOfSupply: company.placeOfSupply || null,
  };
}

export async function getUserBillingProfile(userId: string): Promise<BillingCustomerProfile> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  if (!user) {
    throw createError(404, 'USER_NOT_FOUND', 'User not found');
  }

  const pref = await prisma.userPreference.findUnique({ where: { userId } });
  return buildBillingCustomerProfile({
    email: user.email,
    name: user.name,
    billingCompanyName: pref?.billingCompanyName ?? null,
    billingEmail: pref?.billingEmail ?? null,
    billingPhone: pref?.billingPhone ?? null,
    billingAddressLine1: pref?.billingAddressLine1 ?? null,
    billingAddressLine2: pref?.billingAddressLine2 ?? null,
    billingCityState: pref?.billingCityState ?? null,
    billingPostalCode: pref?.billingPostalCode ?? null,
    billingCountry: pref?.billingCountry ?? null,
    billingGstin: pref?.billingGstin ?? null,
  });
}

export async function updateUserBillingProfile(
  userId: string,
  data: Partial<{
    billingCompanyName: string | null;
    billingEmail: string | null;
    billingPhone: string | null;
    billingAddressLine1: string | null;
    billingAddressLine2: string | null;
    billingCityState: string | null;
    billingPostalCode: string | null;
    billingCountry: string | null;
    billingGstin: string | null;
  }>
): Promise<BillingCustomerProfile> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  if (!user) {
    throw createError(404, 'USER_NOT_FOUND', 'User not found');
  }

  const pref = await prisma.userPreference.upsert({
    where: { userId },
    create: {
      userId,
      billingCompanyName: data.billingCompanyName ?? null,
      billingEmail: data.billingEmail ?? null,
      billingPhone: data.billingPhone ?? null,
      billingAddressLine1: data.billingAddressLine1 ?? null,
      billingAddressLine2: data.billingAddressLine2 ?? null,
      billingCityState: data.billingCityState ?? null,
      billingPostalCode: data.billingPostalCode ?? null,
      billingCountry: data.billingCountry ?? null,
      billingGstin: data.billingGstin ?? null,
    },
    update: {
      ...(data.billingCompanyName !== undefined ? { billingCompanyName: data.billingCompanyName } : {}),
      ...(data.billingEmail !== undefined ? { billingEmail: data.billingEmail } : {}),
      ...(data.billingPhone !== undefined ? { billingPhone: data.billingPhone } : {}),
      ...(data.billingAddressLine1 !== undefined ? { billingAddressLine1: data.billingAddressLine1 } : {}),
      ...(data.billingAddressLine2 !== undefined ? { billingAddressLine2: data.billingAddressLine2 } : {}),
      ...(data.billingCityState !== undefined ? { billingCityState: data.billingCityState } : {}),
      ...(data.billingPostalCode !== undefined ? { billingPostalCode: data.billingPostalCode } : {}),
      ...(data.billingCountry !== undefined ? { billingCountry: data.billingCountry } : {}),
      ...(data.billingGstin !== undefined ? { billingGstin: data.billingGstin } : {}),
    },
  });

  return buildBillingCustomerProfile({
    email: user.email,
    name: user.name,
    billingCompanyName: pref.billingCompanyName,
    billingEmail: pref.billingEmail,
    billingPhone: pref.billingPhone,
    billingAddressLine1: pref.billingAddressLine1,
    billingAddressLine2: pref.billingAddressLine2,
    billingCityState: pref.billingCityState,
    billingPostalCode: pref.billingPostalCode,
    billingCountry: pref.billingCountry,
    billingGstin: pref.billingGstin,
  });
}

async function sendInvoiceEmail(doc: BillingInvoiceDocument): Promise<void> {
  const pdfBuffer = await buildInvoicePdfBuffer(doc);
  await sendNotification(
    doc.userId,
    `Invoice ${doc.invoice.invoiceNumber}`,
    `Your invoice ${doc.invoice.invoiceNumber} for ${doc.planName || 'your plan'} is ready.`,
    ['EMAIL'],
    undefined,
    {
      emailSubject: `Your invoice ${doc.invoice.invoiceNumber} is ready`,
      html: buildInvoiceEmailHtml({ ...doc, invoice: { ...doc.invoice, pdfUrl: doc.invoice.pdfUrl || getInvoicePdfUrl(doc.invoice.id) } }),
      attachments: [
        {
          filename: `invoice-${doc.invoice.invoiceNumber}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    }
  );
}

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

  if (params.idempotencyKey) {
    const existingOrder = await prisma.paymentOrder.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existingOrder) {
      return {
        orderId: existingOrder.id,
        providerOrderId: existingOrder.providerOrderId,
        amountCents: existingOrder.totalCents,
        currency: existingOrder.currency,
        subtotalCents: existingOrder.subtotalCents,
        discountCents: existingOrder.discountCents,
        taxCents: existingOrder.taxCents,
        noPaymentRequired: existingOrder.totalCents <= 0,
        keyId: existingOrder.totalCents <= 0 ? undefined : process.env.RAZORPAY_KEY_ID,
      };
    }
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
  // GST is set per-plan by an admin (stored on the Plan row) and applied to the
  // taxable (post-discount) value. Defaulting to 18 for safety.
  const gstPercent =
    typeof plan.gstPercent === 'number' && Number.isFinite(plan.gstPercent)
      ? Math.max(0, Math.min(100, plan.gstPercent))
      : 18;
  const taxCents = Math.round((totalCents * gstPercent) / 100);
  const finalTotalCents = totalCents + taxCents;
  const type = params.type || 'ONE_TIME';
  const currency = plan.currency;

  // A fully discounted bill (₹0) requires no charge, so we must NOT create a
  // Razorpay order — Razorpay rejects zero-amount orders (which surfaces as a
  // broken checkout / login prompt in test mode). Instead we synthesize an
  // order id and let the paymentOrder record the zero-amount grant.
  const noPaymentRequired = finalTotalCents <= 0;

  let rzpOrderId: string;
  if (noPaymentRequired) {
    rzpOrderId = `free_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  } else {
    // Create Razorpay Order
    const rzpOrder = await createRazorpayOrder({
      amountCents: finalTotalCents,
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

  let order;
  try {
    order = await prisma.paymentOrder.create({
      data: {
        userId: params.userId,
        planId: plan.id,
        type,
        provider: 'razorpay',
        providerOrderId: rzpOrderId,
        currency,
        subtotalCents,
        discountCents,
        taxCents,
        totalCents: finalTotalCents,
        status: 'CREATED',
        couponId,
        idempotencyKey: params.idempotencyKey || null,
        metadata: {
          planName: plan.name,
          planSlug: plan.slug,
          priceCents: plan.priceCents,
          billingInterval: plan.billingInterval,
          gstPercent,
        },
      },
      include: { plan: true },
    });
  } catch (err: any) {
    if (err?.code === 'P2002' && params.idempotencyKey) {
      const existingOrder = await prisma.paymentOrder.findUnique({
        where: { idempotencyKey: params.idempotencyKey },
      });
      if (existingOrder) {
        return {
          orderId: existingOrder.id,
          providerOrderId: existingOrder.providerOrderId,
          amountCents: existingOrder.totalCents,
          currency: existingOrder.currency,
          subtotalCents: existingOrder.subtotalCents,
          discountCents: existingOrder.discountCents,
          taxCents: existingOrder.taxCents,
          noPaymentRequired: existingOrder.totalCents <= 0,
          keyId: existingOrder.totalCents <= 0 ? undefined : process.env.RAZORPAY_KEY_ID,
        };
      }
    }
    throw err;
  }

  return {
    orderId: order.id,
    providerOrderId: order.providerOrderId,
    amountCents: order.totalCents,
    currency: order.currency,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    taxCents: order.taxCents,
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
  subtotalCents?: number;
  discountCents?: number;
  taxCents?: number;
  autoRenew?: boolean;
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

  const result = await prisma.$transaction(async (tx) => {
    // Generate sequential invoice number: INV-YEAR-RANDOM
    const year = new Date().getFullYear();
    const invoiceNumber = `INV-${year}-${Math.floor(100000 + Math.random() * 900000)}`;

    const subtotalCents = params.subtotalCents ?? params.amountCents;
    const discountCents = params.discountCents || 0;
    const taxCents = params.taxCents || 0;
    const grossAmountCents = subtotalCents;
    const netAmountCents = params.amountCents;

    // A completed PaymentOrder is the purchase boundary. Activate a Subscription so
    // the entitlements resolver returns the paid plan (otherwise the user stays
    // on the Free tier even though the ledger shows the payment as CAPTURED).
    // autoRenew is true when the user chose recurring Auto-pay and false for a
    // one-time purchase. Renewals always happen at the full plan price — the
    // coupon was already applied only to this initial charge.
    let subscriptionId = params.subscriptionId || null;
    if (!subscriptionId && params.orderId && params.planId) {
      // Idempotency: reuse an existing active subscription for this order/plan.
      const existingSub = await tx.subscription.findFirst({
        where: {
          userId: params.userId,
          planId: params.planId,
          OR: [
            { status: { in: ['ACTIVE', 'PAST_DUE'] } },
            { providerSubscriptionId: `local_${params.orderId}` },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });

      if (existingSub) {
        subscriptionId = existingSub.id;
      } else {
        const plan = await tx.plan.findUnique({ where: { id: params.planId } });
        const now = new Date();
        const isYearly = plan?.billingInterval === 'YEAR';
        const periodEnd = new Date(
          now.getTime() + (isYearly ? 365 : 30) * 24 * 60 * 60 * 1000
        );

        const newSub = await tx.subscription.create({
          data: {
            userId: params.userId,
            planId: params.planId,
            provider: params.provider,
            providerSubscriptionId: `local_${params.orderId}`,
            status: 'ACTIVE',
            billingInterval: plan?.billingInterval || 'MONTH',
            quantity: 1,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            startedAt: now,
            autoRenew: params.autoRenew ?? false,
          },
        });

        await tx.subscriptionEvent.create({
          data: {
            subscriptionId: newSub.id,
            eventType: 'ACTIVATED',
            provider: params.provider,
            occurredAt: now,
          },
        });

        subscriptionId = newSub.id;
      }
    }

    const taxSnapshot = await resolveInvoiceTaxSnapshot(tx, params.userId, taxCents);

    const invoice = await tx.invoice.create({
      data: {
        userId: params.userId,
        subscriptionId,
        orderId: params.orderId || null,
        provider: params.provider,
        invoiceNumber,
        status: 'PAID',
        currency: params.currency,
        subtotalCents,
        discountCents,
        taxCents,
        cgstCents: taxSnapshot.cgstCents,
        sgstCents: taxSnapshot.sgstCents,
        igstCents: taxSnapshot.igstCents,
        sac: taxSnapshot.sac,
        placeOfSupply: taxSnapshot.placeOfSupply,
        totalCents: netAmountCents,
        paidAt: new Date(),
        pdfUrl: null,
      },
    });

    const transaction = await tx.billingTransaction.create({
      data: {
        userId: params.userId,
        subscriptionId,
        orderId: params.orderId || null,
        invoiceId: invoice.id,
        planId: params.planId || null,
        couponId: params.couponId || null,
        provider: params.provider,
        providerPaymentId: params.providerPaymentId,
        providerOrderId: params.providerOrderId || null,
        providerSubscriptionId: params.providerSubscriptionId || null,
        transactionType: subscriptionId ? 'SUBSCRIPTION_INITIAL' : 'PAYMENT',
        status: 'CAPTURED',
        currency: params.currency,
        grossAmountCents,
        discountCents,
        taxCents,
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

    return { transaction, invoice };
  });

  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, email: true, name: true },
  });

  const plan = params.planId
    ? await prisma.plan.findUnique({ where: { id: params.planId }, select: { name: true, slug: true, billingInterval: true } })
    : null;

  if (user && result.invoice) {
    const pdfUrl = getInvoicePdfUrl(result.invoice.id);
    await prisma.invoice.update({
      where: { id: result.invoice.id },
      data: { pdfUrl },
    });

    const doc = buildInvoiceDocument({
      userId: user.id,
      invoice: {
        ...result.invoice,
        pdfUrl,
      },
      user,
      billingProfile: await getUserBillingProfile(user.id),
      planName: plan?.name || (params.metadata?.planName as string | undefined) || undefined,
      planSlug: plan?.slug || (params.metadata?.planSlug as string | undefined) || undefined,
      subscriptionId: result.transaction.subscriptionId,
      transactionId: result.transaction.id,
      providerPaymentId: params.providerPaymentId,
      providerOrderId: params.providerOrderId,
      providerSubscriptionId: params.providerSubscriptionId,
      autoRenew: params.autoRenew ?? null,
      billingInterval: plan?.billingInterval || (params.metadata?.billingInterval as string | undefined) || undefined,
    });

    try {
      await sendInvoiceEmail(doc);
    } catch (err) {
      console.warn('[Billing] Failed to send invoice email:', err);
    }
  }

  return result.transaction;
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
            const subtotalCents = order?.subtotalCents || payment.amount;
            const taxCents = order?.taxCents || 0;
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
              subtotalCents,
              discountCents: order?.discountCents || 0,
              taxCents,
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
            const planSubtotal = sub.plan.priceCents;
            const planTax = Math.round((planSubtotal * (sub.plan.gstPercent || 18)) / 100);

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
                subtotalCents: planSubtotal,
                taxCents: planTax,
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
          const refund = await prisma.refund.findFirst({
            where: {
              provider: 'razorpay',
              providerRefundId: refundEntity.id,
            },
          });
          if (refund) {
            await prisma.refund.update({
              where: { id: refund.id },
              data: { status: 'PROCESSED', processedAt: new Date() },
            });
            // Reconcile the parent transaction status and revoke access if fully refunded.
            await rollupRefundStatus(refund.transactionId);
          }
        }
        break;
      }

      case 'refund.failed': {
        const failedEntity = event.payload?.refund?.entity;
        if (failedEntity) {
          await prisma.refund.updateMany({
            where: {
              provider: 'razorpay',
              providerRefundId: failedEntity.id,
            },
            data: { status: 'FAILED' },
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

  // Recompute the transaction status and revoke access if it's now fully refunded.
  await rollupRefundStatus(transaction.id);

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

/**
 * Recompute a transaction's ledger status from its PROCESSED refunds and, when a
 * transaction becomes fully refunded, revoke access by cancelling the linked
 * subscription immediately. Shared by the admin refund path and the Razorpay
 * `refund.processed` webhook so both stay consistent.
 */
export async function rollupRefundStatus(transactionId: string): Promise<PaymentStatus | null> {
  const tx = await prisma.billingTransaction.findUnique({
    where: { id: transactionId },
    include: { refunds: true },
  });
  if (!tx) return null;

  const totalRefundedCents = tx.refunds
    .filter((r) => r.status === 'PROCESSED')
    .reduce((acc, r) => acc + r.amountCents, 0);

  let newStatus: PaymentStatus = tx.status;
  if (totalRefundedCents >= tx.netAmountCents && tx.netAmountCents > 0) {
    newStatus = 'REFUNDED';
  } else if (totalRefundedCents > 0) {
    newStatus = 'PARTIALLY_REFUNDED';
  }

  if (newStatus !== tx.status) {
    await prisma.billingTransaction.update({
      where: { id: transactionId },
      data: { status: newStatus },
    });
  }

  // Full refund: revoke the user's access immediately by cancelling the plan the
  // refunded payment purchased (if it is still active).
  if (newStatus === 'REFUNDED' && tx.subscriptionId) {
    const sub = await prisma.subscription.findUnique({ where: { id: tx.subscriptionId } });
    if (sub && (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE')) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'CANCELLED', endedAt: new Date(), autoRenew: false, cancelAtPeriodEnd: false },
      });
      await recordSubscriptionEvent({
        subscriptionId: sub.id,
        eventType: 'CANCELLED',
        provider: 'razorpay',
        occurredAt: new Date(),
        payload: { reason: 'FULL_REFUND', transactionId },
      });
    }
  }

  return newStatus;
}

export async function listUserInvoices(userId: string) {
  const invoices = await prisma.invoice.findMany({
    where: { userId },
    orderBy: { issuedAt: 'desc' },
    take: 20,
    include: {
      subscription: {
        include: {
          plan: true,
        },
      },
      order: true,
      transactions: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  return invoices.map((invoice) => ({
    ...invoice,
    pdfUrl: invoice.pdfUrl || getInvoicePdfUrl(invoice.id),
  }));
}

export async function getUserInvoice(userId: string, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, userId },
    include: {
      user: { select: { id: true, email: true, name: true } },
      subscription: {
        include: {
          plan: true,
        },
      },
      order: true,
      transactions: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!invoice) {
    throw createError(404, 'INVOICE_NOT_FOUND', 'Invoice not found');
  }

  return {
    ...invoice,
    pdfUrl: invoice.pdfUrl || getInvoicePdfUrl(invoice.id),
  };
}

export async function processBillingLifecycleNotifications(): Promise<{
  remindersSent: number;
  expiredSubscriptions: number;
}> {
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const reminderWindows = [3, 1, 0];

  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: { in: ['ACTIVE', 'PAST_DUE'] },
      currentPeriodEnd: { gte: new Date(now.getTime() - dayMs), lte: new Date(now.getTime() + 4 * dayMs) },
    },
    include: { plan: true, user: true },
    take: 200,
  });

  let remindersSent = 0;
  let expiredSubscriptions = 0;

  for (const sub of subscriptions) {
    const msLeft = sub.currentPeriodEnd.getTime() - now.getTime();
    const daysLeft = Math.ceil(msLeft / dayMs);
    const normalizedDaysLeft = Math.max(0, daysLeft);

    for (const threshold of reminderWindows) {
      if (normalizedDaysLeft !== threshold) continue;

      const logTitle = `BILLING_REMINDER_${threshold}_${sub.id}`;
      const alreadySent = await prisma.notificationLog.findFirst({
        where: {
          userId: sub.userId,
          channel: 'EMAIL',
          title: logTitle,
        },
      });

      if (alreadySent) break;

      try {
        await sendNotification(
          sub.userId,
          `Your plan renews in ${threshold} day${threshold === 1 ? '' : 's'}`,
          `Your ${sub.plan.name} plan expires on ${sub.currentPeriodEnd.toLocaleDateString('en-IN')}. Renewal is based on the full plan price, and coupons are not reused on renewals.`,
          ['EMAIL'],
          undefined,
          {
            logTitle,
            emailSubject: `Your ${sub.plan.name} plan renews in ${threshold} day${threshold === 1 ? '' : 's'}`,
            html: `
              <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#ffffff;color:#111827">
                <h1 style="margin:0 0 12px;font-size:26px">Renewal reminder</h1>
                <p style="margin:0 0 16px;color:#4b5563">
                  Your <strong>${sub.plan.name}</strong> plan expires on <strong>${sub.currentPeriodEnd.toLocaleDateString('en-IN')}</strong>.
                </p>
                <div style="padding:16px;border:1px solid #e5e7eb;border-radius:14px;background:#f9fafb">
                  <p style="margin:0 0 8px"><strong>Renewal price:</strong> ${new Intl.NumberFormat('en-IN', { style: 'currency', currency: sub.plan.currency, maximumFractionDigits: 0 }).format(sub.plan.priceCents / 100)}</p>
                  <p style="margin:0"><strong>Auto-pay:</strong> ${sub.autoRenew ? 'Enabled' : 'Disabled'}</p>
                </div>
              </div>
            `,
          }
        );
        remindersSent++;
      } catch (err) {
        console.warn('[Billing] Failed to send renewal reminder email:', err);
      }

      break;
    }

    const shouldExpire =
      msLeft < 0 &&
      (sub.providerSubscriptionId.startsWith('local_') || !sub.autoRenew);

    if (shouldExpire) {
      const logTitle = `BILLING_EXPIRED_${sub.id}`;
      const alreadySent = await prisma.notificationLog.findFirst({
        where: {
          userId: sub.userId,
          channel: 'EMAIL',
          title: logTitle,
        },
      });

      await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          status: 'EXPIRED',
          endedAt: sub.endedAt || now,
          autoRenew: false,
          cancelAtPeriodEnd: false,
        },
      });
      expiredSubscriptions++;

      if (!alreadySent) {
        try {
          await sendNotification(
            sub.userId,
            `${sub.plan.name} access ended`,
            `Your ${sub.plan.name} plan expired on ${sub.currentPeriodEnd.toLocaleDateString('en-IN')}. Your account has been returned to the free tier.`,
            ['EMAIL'],
            undefined,
            {
              logTitle,
              emailSubject: `${sub.plan.name} access ended`,
              html: `
                <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#ffffff;color:#111827">
                  <h1 style="margin:0 0 12px;font-size:26px">Plan expired</h1>
                  <p style="margin:0 0 16px;color:#4b5563">
                    Your <strong>${sub.plan.name}</strong> plan ended on <strong>${sub.currentPeriodEnd.toLocaleDateString('en-IN')}</strong>.
                  </p>
                  <div style="padding:16px;border:1px solid #e5e7eb;border-radius:14px;background:#f9fafb">
                    <p style="margin:0"><strong>Current status:</strong> ${sub.providerSubscriptionId.startsWith('local_') ? 'Local billing expired' : 'Waiting for renewal confirmation'}</p>
                  </div>
                </div>
              `,
            }
          );
        } catch (err) {
          console.warn('[Billing] Failed to send expiry email:', err);
        }
      }
    }
  }

  return { remindersSent, expiredSubscriptions };
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

/**
 * Process due renewals for locally-managed, auto-renewing subscriptions.
 *
 * Unified lifecycle: every purchase creates ONE local Subscription. For
 * subscriptions tied to a real Razorpay subscription (providerSubscriptionId
 * does NOT start with "local_"), renewals are billed by Razorpay and arrive via
 * webhooks — this scheduler skips those. For `local_`-managed subscriptions
 * (test/dummy mode), we simulate the auto-renew: book a SUBSCRIPTION_RENEWAL
 * transaction at the FULL current plan price with zero coupon/discount, extend
 * the period, and keep the plan active. The coupon is only ever applied to the
 * initial charge (it was already redeemed then), so renewals are always at full
 * price.
 */
export async function renewDueLocalSubscriptions(): Promise<number> {
  const now = new Date();
  const due = await prisma.subscription.findMany({
    where: {
      status: 'ACTIVE',
      autoRenew: true,
      currentPeriodEnd: { lte: now },
      providerSubscriptionId: { startsWith: 'local_' },
    },
    include: { plan: true },
    take: 50,
  });

  let renewed = 0;
  for (const sub of due) {
    const plan = sub.plan;
    const periodMs =
      plan.billingInterval === 'YEAR'
        ? 365 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;
    const nextStart = new Date(sub.currentPeriodEnd);
    const nextEnd = new Date(nextStart.getTime() + periodMs);
    const invoiceNumber = `INV-${nextStart.getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const simPaymentId = `sim_${sub.id}_${nextStart.getTime()}`;
    const gross = plan.priceCents;
    const gstPct =
      typeof plan.gstPercent === 'number' && Number.isFinite(plan.gstPercent)
        ? Math.max(0, Math.min(100, plan.gstPercent))
        : 18;
    const renewalTaxCents = Math.round((gross * gstPct) / 100);
    const renewalTotal = gross + renewalTaxCents;

    await prisma.$transaction(async (tx) => {
      // Idempotency guard — never book the same renewal period twice.
      const existing = await tx.billingTransaction.findUnique({
        where: {
          provider_providerPaymentId: {
            provider: 'razorpay',
            providerPaymentId: simPaymentId,
          },
        },
      });
      if (existing) return;

      const taxSnapshot = await resolveInvoiceTaxSnapshot(tx, sub.userId, renewalTaxCents);

      const invoice = await tx.invoice.create({
        data: {
          userId: sub.userId,
          subscriptionId: sub.id,
          provider: 'razorpay',
          invoiceNumber,
          status: 'PAID',
          currency: plan.currency,
          subtotalCents: gross,
          discountCents: 0,
          taxCents: renewalTaxCents,
          cgstCents: taxSnapshot.cgstCents,
          sgstCents: taxSnapshot.sgstCents,
          igstCents: taxSnapshot.igstCents,
          sac: taxSnapshot.sac,
          placeOfSupply: taxSnapshot.placeOfSupply,
          totalCents: renewalTotal,
          issuedAt: nextStart,
          paidAt: nextStart,
        },
      });

      await tx.billingTransaction.create({
        data: {
          userId: sub.userId,
          subscriptionId: sub.id,
          invoiceId: invoice.id,
          planId: plan.id,
          provider: 'razorpay',
          providerPaymentId: simPaymentId,
          providerSubscriptionId: sub.providerSubscriptionId,
          transactionType: 'SUBSCRIPTION_RENEWAL',
          status: 'CAPTURED',
          currency: plan.currency,
          grossAmountCents: gross,
          discountCents: 0,
          taxCents: renewalTaxCents,
          netAmountCents: renewalTotal,
          paidAt: nextStart,
          metadata: { simulated: true, reason: 'LOCAL_SIMULATED_RENEWAL' },
        },
      });

      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: 'ACTIVE',
          currentPeriodStart: nextStart,
          currentPeriodEnd: nextEnd,
        },
      });

      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: sub.id,
          eventType: 'CHARGED',
          provider: 'razorpay',
          occurredAt: nextStart,
        },
      });
    });

    renewed++;
    console.log(
      `[Billing] Renewed local subscription ${sub.id} (${plan.name}) until ${nextEnd.toISOString()}.`
    );
  }

  return renewed;
}
