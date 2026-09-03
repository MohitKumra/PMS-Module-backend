// backend/src/services/billing.service.ts
// Handles orders, invoices, transactions ledger, refunds, and webhook processing.

import { prisma } from '../lib/prismaClient';
import { env } from '../config/env';
import {
  renderSubscriptionRenewalReminder,
  renderSubscriptionExpired,
  renderSubscriptionUpgraded,
  renderSubscriptionDowngraded,
} from '../lib/mailer';
import { createError } from '../middleware/errorHandler';
import { createRazorpayOrder, createRazorpayRefund, fetchRazorpayPayment, verifyRazorpayPaymentSignature } from '../providers/razorpay/razorpay.payment';
import {
  createRazorpayProviderPlan,
  createRazorpaySubscription,
  createRazorpayOffer,
  listRazorpayOffers,
  cancelRazorpaySubscription,
  updateRazorpaySubscription,
} from '../providers/razorpay/razorpay.subscription';
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

export async function calculatePlanUpgradeProration(params: {
  userId: string;
  targetPlanId: string;
}) {
  const targetPlan = await prisma.plan.findUnique({
    where: { id: params.targetPlanId },
  });

  if (!targetPlan) {
    throw createError(404, 'PLAN_NOT_FOUND', 'Target plan not found');
  }

  // Find user's active paid subscription
  const activeSub = await prisma.subscription.findFirst({
    where: {
      userId: params.userId,
      status: 'ACTIVE',
      plan: { priceCents: { gt: 0 } },
    },
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!activeSub) {
    const gstPercent =
      typeof targetPlan.gstPercent === 'number' && Number.isFinite(targetPlan.gstPercent)
        ? Math.max(0, Math.min(100, targetPlan.gstPercent))
        : 18;
    const taxCents = Math.round((targetPlan.priceCents * gstPercent) / 100);

    return {
      isUpgrade: false,
      currentPlan: null,
      targetPlan: {
        id: targetPlan.id,
        name: targetPlan.name,
        slug: targetPlan.slug,
        priceCents: targetPlan.priceCents,
        billingInterval: targetPlan.billingInterval,
        currency: targetPlan.currency,
        gstPercent,
      },
      proratedCreditCents: 0,
      daysRemaining: 0,
      subtotalCents: targetPlan.priceCents,
      discountCents: 0,
      taxableAmountCents: targetPlan.priceCents,
      gstPercent,
      taxCents,
      totalCents: targetPlan.priceCents + taxCents,
    };
  }

  // Calculate unused period ratio
  const nowMs = Date.now();
  const startMs = activeSub.currentPeriodStart.getTime();
  const endMs = activeSub.currentPeriodEnd.getTime();
  const totalDurationMs = Math.max(1, endMs - startMs);
  const remainingMs = Math.max(0, endMs - nowMs);
  const unusedRatio = Math.min(1, Math.max(0, remainingMs / totalDurationMs));
  const daysRemaining = Math.max(0, Math.ceil(remainingMs / (1000 * 60 * 60 * 24)));

  const currentPlanPrice = activeSub.plan.priceCents;
  const rawCredit = Math.round(currentPlanPrice * unusedRatio);
  const proratedCreditCents = Math.max(0, Math.min(currentPlanPrice, rawCredit));

  const isUpgrade = targetPlan.priceCents > currentPlanPrice;
  const creditAppliedCents = isUpgrade ? Math.min(targetPlan.priceCents, proratedCreditCents) : 0;
  const taxableAmountCents = Math.max(0, targetPlan.priceCents - creditAppliedCents);
  const gstPercent =
    typeof targetPlan.gstPercent === 'number' && Number.isFinite(targetPlan.gstPercent)
      ? Math.max(0, Math.min(100, targetPlan.gstPercent))
      : 18;
  const taxCents = Math.round((taxableAmountCents * gstPercent) / 100);
  const totalCents = taxableAmountCents + taxCents;

  return {
    isUpgrade,
    currentPlan: {
      id: activeSub.plan.id,
      name: activeSub.plan.name,
      slug: activeSub.plan.slug,
      priceCents: activeSub.plan.priceCents,
      billingInterval: activeSub.billingInterval,
      currentPeriodStart: activeSub.currentPeriodStart,
      currentPeriodEnd: activeSub.currentPeriodEnd,
      daysRemaining,
      rawCreditCents: rawCredit,
    },
    targetPlan: {
      id: targetPlan.id,
      name: targetPlan.name,
      slug: targetPlan.slug,
      priceCents: targetPlan.priceCents,
      billingInterval: targetPlan.billingInterval,
      currency: targetPlan.currency,
      gstPercent,
    },
    proratedCreditCents: creditAppliedCents,
    daysRemaining,
    subtotalCents: targetPlan.priceCents,
    discountCents: creditAppliedCents,
    taxableAmountCents,
    gstPercent,
    taxCents,
    totalCents,
  };
}

/**
 * Ensures an active Razorpay Plan exists for the specified Plan and billing interval
 * with the full undiscounted plan price (priceCents + GST).
 */
export async function ensureRazorpayPlanForPlan(planId: string) {
  const plan = await prisma.plan.findUnique({
    where: { id: planId },
    include: { paymentProviderPlans: { where: { provider: 'razorpay', isActive: true } } },
  });
  if (!plan) throw createError(404, 'PLAN_NOT_FOUND', 'Plan not found');

  const gstPercent =
    typeof plan.gstPercent === 'number' && Number.isFinite(plan.gstPercent)
      ? Math.max(0, Math.min(100, plan.gstPercent))
      : 18;
  const fullPriceWithTax = plan.priceCents + Math.round((plan.priceCents * gstPercent) / 100);

  // Check if we already have an active PaymentProviderPlan with matching amount and interval
  const existingProviderPlan = plan.paymentProviderPlans.find(
    (p) => p.amountCents === fullPriceWithTax && p.billingInterval === plan.billingInterval
  );

  if (existingProviderPlan) {
    return existingProviderPlan;
  }

  // Create recurring plan in Razorpay
  const interval = plan.billingInterval === 'YEAR' ? 'yearly' : 'monthly';
  const rzpPlan = await createRazorpayProviderPlan({
    name: `${plan.name} (${plan.billingInterval})`,
    amountCents: fullPriceWithTax,
    currency: plan.currency || 'INR',
    interval,
    description: plan.description || `${plan.name} recurring subscription`,
  });

  // Save to DB
  const providerPlan = await prisma.paymentProviderPlan.create({
    data: {
      planId: plan.id,
      provider: 'razorpay',
      providerPlanId: rzpPlan.id,
      currency: plan.currency || 'INR',
      amountCents: fullPriceWithTax,
      billingInterval: plan.billingInterval,
      isActive: true,
    },
  });

  return providerPlan;
}
/**
 * Computes the Unix timestamp (in seconds) for the start of the next billing cycle.
 * Uses strict UTC calendar month clamping (e.g. Jan 31 -> Feb 28/29 instead of March) to match
 * Razorpay's recurring subscription anchor schedule across all timezones.
 */
export function computeNextCycleTimestamp(
  billingInterval: 'MONTH' | 'YEAR' | 'ONE_TIME' | string,
  fromDate: Date = new Date()
): number {
  const next = new Date(fromDate);
  if (billingInterval === 'YEAR') {
    const currentYear = next.getUTCFullYear();
    const currentMonth = next.getUTCMonth();
    const currentDay = next.getUTCDate();

    next.setUTCFullYear(currentYear + 1);
    // If anchored on Feb 29 in a leap year, clamp to Feb 28 in a non-leap year
    if (currentMonth === 1 && currentDay === 29 && next.getUTCMonth() !== 1) {
      next.setUTCMonth(1, 28);
    }
  } else {
    const targetDay = next.getUTCDate();
    next.setUTCMonth(next.getUTCMonth() + 1);
    if (next.getUTCDate() !== targetDay) {
      next.setUTCDate(0); // Clamps to last valid day of target month (e.g. Feb 28/29 or April 30)
    }
  }
  return Math.floor(next.getTime() / 1000);
}

export async function createCheckoutOrder(params: {
  userId: string;
  planId: string;
  type?: PaymentOrderType;
  couponCode?: string;
  idempotencyKey?: string;
  /** Allow checkout of hidden/inactive plans (e.g. custom-plan carrier plans). */
  allowInactive?: boolean;
}) {
  const plan = await prisma.plan.findUnique({ where: { id: params.planId } });
  if (!plan || (!plan.isActive && !params.allowInactive)) {
    throw createError(400, 'INVALID_PLAN', 'Selected plan is not available');
  }

  // If user's subscription is currently PAUSED by admin, block any new checkout
  const pausedSub = await prisma.subscription.findFirst({
    where: {
      userId: params.userId,
      status: 'PAUSED',
    },
    include: { plan: true },
  });
  if (pausedSub) {
    throw createError(
      403,
      'SUBSCRIPTION_PAUSED',
      'Your billing has been paused by administration. You cannot purchase or change plans while your account is paused. Please contact support to resume your subscription.'
    );
  }

  if (params.idempotencyKey) {
    const existingOrder = await prisma.paymentOrder.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existingOrder) {
      const isSub = existingOrder.type === 'SUBSCRIPTION_INITIAL' && !existingOrder.providerOrderId.startsWith('free_');
      return {
        orderId: existingOrder.id,
        providerOrderId: existingOrder.providerOrderId,
        providerSubscriptionId: isSub ? existingOrder.providerOrderId : undefined,
        isSubscription: isSub,
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

  const subtotalCents = plan.priceCents;
  let discountCents = 0;
  let couponId: string | undefined;
  let prorationCreditCents = 0;
  let isUpgrade = false;

  // Calculate upgrade proration if user is upgrading from an active paid tier
  const proration = await calculatePlanUpgradeProration({
    userId: params.userId,
    targetPlanId: plan.id,
  });

  if (proration.isUpgrade && proration.proratedCreditCents > 0) {
    prorationCreditCents = proration.proratedCreditCents;
    discountCents += prorationCreditCents;
    isUpgrade = true;
  }

  let appliedCoupon: any = null;
  if (params.couponCode?.trim()) {
    const validated = await validateCoupon({
      code: params.couponCode,
      userId: params.userId,
      planId: plan.id,
      subtotalCents: Math.max(0, subtotalCents - prorationCreditCents),
    });
    discountCents += validated.discountCents;
    couponId = validated.coupon.id;
    appliedCoupon = validated.coupon;
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
  // Razorpay order — Razorpay rejects zero-amount orders. Instead we synthesize
  // an order id and let the paymentOrder record the zero-amount grant.
  const noPaymentRequired = finalTotalCents <= 0;
  const isSubscriptionCheckout = type === 'SUBSCRIPTION_INITIAL' && !noPaymentRequired;

  let rzpOrderId: string;
  let providerSubscriptionId: string | undefined;
  let scheduledStartAt: number | undefined;

  if (noPaymentRequired) {
    rzpOrderId = `free_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  } else if (isSubscriptionCheckout) {
    // Ensure recurring Razorpay Provider Plan exists at full price
    const providerPlan = await ensureRazorpayPlanForPlan(plan.id);

    const totalCycles = plan.billingInterval === 'YEAR' ? 5 : 60;
    if (totalCycles <= 1) {
      throw createError(
        400,
        'INVALID_SUBSCRIPTION_CYCLES',
        'Recurring auto-pay requires at least 2 billing cycles. Use one-time payment for single-period access.'
      );
    }
    const isDiscountedFirstCycle = finalTotalCents < providerPlan.amountCents;

    let rzpSub: any;

    if (isDiscountedFirstCycle) {
      // Calculate start of cycle 2 using calendar month alignment
      scheduledStartAt = computeNextCycleTimestamp(plan.billingInterval);

      rzpSub = await createRazorpaySubscription({
        planId: providerPlan.providerPlanId,
        totalCount: totalCycles - 1,
        customerNotify: 1,
        startAt: scheduledStartAt,
        addons: [
          {
            item: {
              name: `${plan.name} (Discounted 1st Cycle)`,
              amount: finalTotalCents,
              currency: plan.currency || 'INR',
            },
          },
        ],
        notes: {
          userId: params.userId,
          planId: plan.id,
          couponId: couponId || undefined,
          discountCents: discountCents > 0 ? String(discountCents) : undefined,
          prorationCreditCents: prorationCreditCents > 0 ? String(prorationCreditCents) : undefined,
          isUpgrade: isUpgrade ? 'true' : undefined,
        },
      });
    } else {
      rzpSub = await createRazorpaySubscription({
        planId: providerPlan.providerPlanId,
        totalCount: totalCycles,
        customerNotify: 1,
        notes: {
          userId: params.userId,
          planId: plan.id,
          couponId: couponId || undefined,
          prorationCreditCents: prorationCreditCents > 0 ? String(prorationCreditCents) : undefined,
          isUpgrade: isUpgrade ? 'true' : undefined,
        },
      });
    }

    rzpOrderId = rzpSub.id;
    providerSubscriptionId = rzpSub.id;
  } else {
    // Create one-time Razorpay Order
    const rzpOrder = await createRazorpayOrder({
      amountCents: finalTotalCents,
      currency,
      receipt: `rcpt_${Date.now()}`,
      notes: {
        userId: params.userId,
        planId: plan.id,
        couponId: couponId || undefined,
        prorationCreditCents: prorationCreditCents > 0 ? String(prorationCreditCents) : undefined,
        isUpgrade: isUpgrade ? 'true' : undefined,
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
          isSubscription: isSubscriptionCheckout,
          providerSubscriptionId,
          startAt: scheduledStartAt || null,
          isDiscountedFirstCycle: Boolean(isSubscriptionCheckout && finalTotalCents < (plan.priceCents + Math.round((plan.priceCents * gstPercent) / 100))),
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
        const isSub = existingOrder.type === 'SUBSCRIPTION_INITIAL' && !existingOrder.providerOrderId.startsWith('free_');
        const existingMeta = (existingOrder.metadata as Record<string, any>) || {};
        return {
          orderId: existingOrder.id,
          providerOrderId: existingOrder.providerOrderId,
          providerSubscriptionId: isSub ? existingOrder.providerOrderId : undefined,
          offerId: existingMeta.offerId || undefined,
          isSubscription: isSub,
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
    providerSubscriptionId,
    offerId: undefined,
    isSubscription: isSubscriptionCheckout,
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
  isRenewal?: boolean;
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

  let oldProviderSubIdToCancel: string | null = null;

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
    if (!subscriptionId && (params.orderId || params.providerSubscriptionId) && params.planId) {
      const existingSub = await tx.subscription.findFirst({
        where: {
          userId: params.userId,
          status: { in: ['ACTIVE', 'PAST_DUE', 'PAUSED'] },
        },
        orderBy: { createdAt: 'desc' },
      });

      const plan = await tx.plan.findUnique({ where: { id: params.planId } });
      const now = new Date();

      // Synchronize initial periodEnd with startAt if scheduled in payment order metadata,
      // otherwise use calendar-accurate month/year arithmetic
      let periodEnd: Date;
      let orderRecord = null;
      if (params.orderId) {
        orderRecord = await tx.paymentOrder.findUnique({ where: { id: params.orderId } });
      } else if (params.providerSubscriptionId) {
        orderRecord = await tx.paymentOrder.findFirst({
          where: { provider: params.provider, providerOrderId: params.providerSubscriptionId },
        });
      }

      const orderMeta = (orderRecord?.metadata as Record<string, any>) || {};
      if (orderMeta.startAt) {
        periodEnd = new Date(Number(orderMeta.startAt) * 1000);
      } else {
        const nextCycleTs = computeNextCycleTimestamp(plan?.billingInterval || 'MONTH', now);
        periodEnd = new Date(nextCycleTs * 1000);
      }

      const targetProviderSubId =
        params.providerSubscriptionId ||
        (params.autoRenew ? `rzp_sub_${params.orderId || Date.now()}` : `local_${params.orderId || Date.now()}`);

      oldProviderSubIdToCancel = null;
      if (existingSub) {
        if (
          existingSub.providerSubscriptionId &&
          params.providerSubscriptionId &&
          existingSub.providerSubscriptionId !== params.providerSubscriptionId &&
          existingSub.providerSubscriptionId.startsWith('sub_')
        ) {
          oldProviderSubIdToCancel = existingSub.providerSubscriptionId;
        }

        // Upgrade/Update existing subscription to the new plan!
        const updatedSub = await tx.subscription.update({
          where: { id: existingSub.id },
          data: {
            planId: params.planId,
            provider: params.provider,
            providerSubscriptionId: params.providerSubscriptionId || existingSub.providerSubscriptionId,
            scheduledPlanId: null,
            scheduledChangeAt: null,
            status: 'ACTIVE',
            billingInterval: plan?.billingInterval || 'MONTH',
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            startedAt: now,
            autoRenew: params.autoRenew ?? true,
            cancelAtPeriodEnd: false,
            endedAt: null,
          },
        });

        await tx.subscriptionEvent.create({
          data: {
            subscriptionId: updatedSub.id,
            eventType: 'ACTIVATED',
            provider: params.provider,
            occurredAt: now,
          },
        });

        subscriptionId = updatedSub.id;
      } else {
        const newSub = await tx.subscription.create({
          data: {
            userId: params.userId,
            planId: params.planId,
            provider: params.provider,
            providerSubscriptionId: targetProviderSubId,
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
        transactionType: params.isRenewal
          ? 'SUBSCRIPTION_RENEWAL'
          : (subscriptionId ? 'SUBSCRIPTION_INITIAL' : 'PAYMENT'),
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

    // Dispatch invoice email in background so the verification endpoint responds immediately
    sendInvoiceEmail(doc).catch((err) => {
      console.warn('[Billing] Failed to send invoice email in background:', err);
    });

    const isUpgradeOrder =
      params.metadata?.isUpgrade === 'true' ||
      params.metadata?.isUpgrade === true ||
      (params.orderId &&
        (
          await prisma.paymentOrder
            .findUnique({ where: { id: params.orderId } })
            .catch(() => null)
        )?.metadata &&
        ((await prisma.paymentOrder.findUnique({ where: { id: params.orderId } }))?.metadata as any)
          ?.isUpgrade);

    if (isUpgradeOrder && oldProviderSubIdToCancel) {
      try {
        await cancelRazorpaySubscription(oldProviderSubIdToCancel, false);
        console.info(`[Billing] Successfully cancelled old Razorpay subscription ${oldProviderSubIdToCancel} after upgrade`);
      } catch (cancelErr: any) {
        console.error(`[Billing] CRITICAL: Failed to cancel old Razorpay subscription ${oldProviderSubIdToCancel} after upgrade:`, cancelErr);
        if (result.transaction.subscriptionId) {
          await prisma.subscriptionEvent.create({
            data: {
              subscriptionId: result.transaction.subscriptionId,
              eventType: 'REQUIRES_RECONCILIATION',
              provider: params.provider,
              occurredAt: new Date(),
              payload: {
                action: 'OLD_SUBSCRIPTION_CANCEL_FAILED',
                oldProviderSubscriptionId: oldProviderSubIdToCancel,
                error: cancelErr?.message || String(cancelErr),
              },
            },
          }).catch((evtErr) => console.error('[Billing] Failed to record reconciliation event:', evtErr));
        }
      }
    }

    if (isUpgradeOrder && user && plan) {
      sendNotification(
        user.id,
        `Plan upgraded to ${plan.name}`,
        `Your subscription has been successfully upgraded to ${plan.name}.`,
        ['EMAIL'],
        undefined,
        {
          emailSubject: `Your plan has been upgraded to ${plan.name}!`,
          html: renderSubscriptionUpgraded({
            planName: plan.name,
            amountPaid: new Intl.NumberFormat('en-IN', {
              style: 'currency',
              currency: params.currency || 'INR',
            }).format(params.amountCents / 100),
            periodEnd: new Date(
              computeNextCycleTimestamp(plan.billingInterval) * 1000
            ).toLocaleDateString('en-IN'),
            appUrl: `${env.FRONTEND_URL}/settings?tab=billing`,
          }),
        }
      ).catch((err) => {
        console.warn('[Billing] Failed to send upgrade notification:', err);
      });
    }
  }

  return result.transaction;
}

export async function processRazorpayWebhook(rawBody: Buffer | string, signature: string | undefined) {
  const isValid = verifyRazorpayWebhookSignature(rawBody, signature);
  if (!isValid) {
    throw createError(400, 'INVALID_SIGNATURE', 'Razorpay webhook signature verification failed.');
  }

  let event: any;
  try {
    const rawString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
    event = typeof rawString === 'string' ? JSON.parse(rawString) : rawString;
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
          const targetOrderId = payment.subscription_id || payment.order_id;
          if (targetOrderId) {
            order = await prisma.paymentOrder.findFirst({
              where: {
                provider: 'razorpay',
                providerOrderId: targetOrderId,
              },
            });
          }

          const userId = notes.userId || order?.userId;
          if (userId) {
            const subtotalCents = order?.subtotalCents || payment.amount;
            const taxCents = order?.taxCents || 0;
            const discountCents = order?.discountCents || 0;
            const planId = notes.planId || order?.planId;
            const couponId = notes.couponId || order?.couponId;
            const isSub = Boolean(payment.subscription_id || (order && order.type === 'SUBSCRIPTION_INITIAL'));

            await recordSuccessfulPayment({
              userId,
              provider: 'razorpay',
              providerPaymentId: payment.id,
              providerOrderId: payment.order_id || undefined,
              providerSubscriptionId: payment.subscription_id || (isSub ? order?.providerOrderId : undefined),
              amountCents: payment.amount,
              currency: payment.currency,
              orderId: order?.id,
              planId,
              couponId,
              subtotalCents,
              discountCents,
              taxCents,
              autoRenew: isSub,
              isRenewal: false,
              metadata: {
                paymentMethod: payment.method,
                email: payment.email,
                contact: payment.contact,
                source: 'WEBHOOK_PAYMENT_CAPTURED',
              },
            });
          }
        }
        break;
      }

      case 'payment.failed': {
        const payment = event.payload?.payment?.entity;
        if (payment) {
          const targetOrderId = payment.subscription_id || payment.order_id;
          if (targetOrderId) {
            await prisma.paymentOrder.updateMany({
              where: {
                provider: 'razorpay',
                providerOrderId: targetOrderId,
                status: 'CREATED',
              },
              data: { status: 'FAILED' },
            });
          }
          console.warn(
            `[Webhook payment.failed] paymentId=${payment.id} targetRef=${targetOrderId || 'unknown'} reason=${payment.error_description || payment.error_code || 'Payment declined'}`
          );
        }
        break;
      }

      case 'subscription.authenticated': {
        const subEntity = event.payload?.subscription?.entity;
        if (subEntity) {
          // Mandate authorized: record event but do NOT treat as cash capture
          console.info(`[Webhook subscription.authenticated] subscriptionId=${subEntity.id}`);
          const sub = await prisma.subscription.findUnique({
            where: {
              provider_providerSubscriptionId: {
                provider: 'razorpay',
                providerSubscriptionId: subEntity.id,
              },
            },
          });
          if (sub) {
            await recordSubscriptionEvent({
              subscriptionId: sub.id,
              eventType: 'CREATED',
              provider: 'razorpay',
              providerEventId,
              payload: subEntity,
            });
          }
        }
        break;
      }

      case 'subscription.activated': {
        const subEntity = event.payload?.subscription?.entity;
        if (subEntity) {
          console.info(`[Webhook subscription.activated] subscriptionId=${subEntity.id}`);
          await prisma.subscription.updateMany({
            where: {
              provider: 'razorpay',
              providerSubscriptionId: subEntity.id,
            },
            data: { status: 'ACTIVE' },
          });
        }
        break;
      }

      case 'subscription.charged': {
        const subEntity = event.payload?.subscription?.entity;
        const paymentEntity = event.payload?.payment?.entity;
        if (subEntity && paymentEntity) {
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
            const nextStart = subEntity.current_start
              ? new Date(subEntity.current_start * 1000)
              : new Date();
            const nextEnd = subEntity.current_end
              ? new Date(subEntity.current_end * 1000)
              : new Date(computeNextCycleTimestamp(sub.billingInterval, nextStart) * 1000);

            // Reconcile plan: Did a scheduled downgrade/plan change take effect?
            let effectivePlanId = sub.planId;
            let effectivePlan = sub.plan;

            if (subEntity.plan_id) {
              const matchedProviderPlan = await prisma.paymentProviderPlan.findFirst({
                where: { provider: 'razorpay', providerPlanId: subEntity.plan_id },
                include: { plan: true },
              });
              if (matchedProviderPlan?.plan) {
                effectivePlanId = matchedProviderPlan.plan.id;
                effectivePlan = matchedProviderPlan.plan;
              }
            } else if (sub.scheduledPlanId) {
              const scheduled = await prisma.plan.findUnique({ where: { id: sub.scheduledPlanId } });
              if (scheduled) {
                effectivePlanId = scheduled.id;
                effectivePlan = scheduled;
              }
            }

            const planSubtotal = effectivePlan.priceCents;
            const planTax = Math.round((planSubtotal * (effectivePlan.gstPercent || 18)) / 100);

            await prisma.subscription.update({
              where: { id: sub.id },
              data: {
                planId: effectivePlanId,
                scheduledPlanId: null, // Clear scheduled downgrade upon successful charge
                scheduledChangeAt: null,
                status: 'ACTIVE',
                currentPeriodStart: nextStart,
                currentPeriodEnd: nextEnd,
              },
            });

            await recordSubscriptionEvent({
              subscriptionId: sub.id,
              eventType: 'CHARGED',
              provider: 'razorpay',
              providerEventId,
              payload: subEntity,
            });

            // Recurring renewal: full plan price of the effective plan with zero coupon discount
            await recordSuccessfulPayment({
              userId: sub.userId,
              provider: 'razorpay',
              providerPaymentId: paymentEntity.id,
              providerSubscriptionId: subEntity.id,
              amountCents: paymentEntity.amount,
              currency: paymentEntity.currency,
              subscriptionId: sub.id,
              planId: effectivePlanId,
              subtotalCents: planSubtotal,
              taxCents: planTax,
              discountCents: 0,
              isRenewal: true,
              autoRenew: true,
              metadata: {
                planName: effectivePlan.name,
                billingInterval: sub.billingInterval,
                source: 'WEBHOOK_SUBSCRIPTION_CHARGED',
              },
            });
            console.info(`[Webhook subscription.charged] subscriptionId=${sub.id} planId=${effectivePlanId} paymentId=${paymentEntity.id} amount=${paymentEntity.amount}`);
          }
        }
        break;
      }

      case 'subscription.updated': {
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
            await recordSubscriptionEvent({
              subscriptionId: sub.id,
              eventType: 'ACTIVATED',
              provider: 'razorpay',
              providerEventId,
              payload: subEntity,
            });
            console.info(`[Webhook subscription.updated] subscriptionId=${sub.id} plan_id=${subEntity.plan_id}`);
          }
        }
        break;
      }

      case 'subscription.halted':
      case 'subscription.pending': {
        const subEntity = event.payload?.subscription?.entity;
        if (subEntity) {
          await prisma.subscription.updateMany({
            where: {
              provider: 'razorpay',
              providerSubscriptionId: subEntity.id,
            },
            data: {
              status: 'PAST_DUE',
              autoRenew: false,
            },
          });
          console.warn(`[Webhook subscription.${eventType.split('.')[1]}] subscriptionId=${subEntity.id} marked PAST_DUE`);
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
            const now = new Date();
            const hasRemainingPaidTime = sub.currentPeriodEnd > now;
            await prisma.subscription.update({
              where: { id: sub.id },
              data: {
                status: hasRemainingPaidTime ? sub.status : 'CANCELLED',
                autoRenew: false,
                cancelAtPeriodEnd: hasRemainingPaidTime,
                endedAt: hasRemainingPaidTime ? null : now,
              },
            });
            await recordSubscriptionEvent({
              subscriptionId: sub.id,
              eventType: 'CANCELLED',
              provider: 'razorpay',
              providerEventId,
              payload: subEntity,
            });
            console.info(`[Webhook subscription.cancelled] subscriptionId=${sub.id} cancelAtPeriodEnd=${hasRemainingPaidTime}`);
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

  // Call Razorpay Refund API if real payment, else simulate locally
  let rzpRefund;
  let refundCurrency = transaction.currency;

  const isMockPayment =
    !transaction.providerPaymentId ||
    transaction.providerPaymentId.startsWith('pay_mock_') ||
    transaction.providerPaymentId.startsWith('sim_') ||
    transaction.providerPaymentId.startsWith('local_') ||
    process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test_dummy');

  if (!isMockPayment && transaction.providerPaymentId) {
    // 1. Check live payment status on Razorpay
    let payment;
    try {
      payment = await fetchRazorpayPayment(transaction.providerPaymentId);
    } catch (err: any) {
      throw createError(
        400,
        'GATEWAY_PAYMENT_FETCH_FAILED',
        `Failed to verify payment with Razorpay: ${err.message || 'Payment not found'}`
      );
    }

    if (!payment) {
      throw createError(404, 'PAYMENT_NOT_FOUND', 'Payment not found on payment gateway.');
    }

    if (payment.status !== 'captured') {
      throw createError(
        400,
        'PAYMENT_NOT_CAPTURED',
        `Payment ${transaction.providerPaymentId} is in "${payment.status}" state on Razorpay (must be captured before refunding). Please capture the payment first.`
      );
    }

    refundCurrency = payment.currency || transaction.currency;

    const rzpCapturedAmount = typeof payment.amount === 'number' ? payment.amount : transaction.netAmountCents;
    const rzpAlreadyRefunded = typeof (payment as any).amount_refunded === 'number' ? (payment as any).amount_refunded : 0;
    const rzpAvailableRefund = rzpCapturedAmount - rzpAlreadyRefunded;

    if (refundAmount > rzpAvailableRefund) {
      throw createError(
        400,
        'EXCEEDS_CAPTURED_AMOUNT',
        `Refund amount (${refundAmount / 100} ${refundCurrency}) exceeds the remaining refundable balance on Razorpay (${rzpAvailableRefund / 100} ${refundCurrency}).`
      );
    }

    rzpRefund = await createRazorpayRefund({
      paymentId: transaction.providerPaymentId,
      amountCents: refundAmount,
      notes: { reason: params.reason, adminId: params.adminAccountId },
    });
  } else {
    rzpRefund = {
      id: `rfnd_mock_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    };
  }

  const refund = await prisma.refund.create({
    data: {
      transactionId: transaction.id,
      userId: transaction.userId,
      provider: transaction.provider,
      providerRefundId: rzpRefund?.id || `rfnd_${Date.now()}`,
      amountCents: refundAmount,
      currency: refundCurrency,
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
            html: renderSubscriptionRenewalReminder({
              planName: sub.plan.name,
              expiryDate: sub.currentPeriodEnd.toLocaleDateString('en-IN'),
              renewalPrice: new Intl.NumberFormat('en-IN', { style: 'currency', currency: sub.plan.currency, maximumFractionDigits: 0 }).format(sub.plan.priceCents / 100),
              autoPayText: sub.autoRenew ? 'Enabled' : 'Disabled',
            }),
          }
        );
        remindersSent++;
      } catch (err) {
        console.warn('[Billing] Failed to send renewal reminder email:', err);
      }

      break;
    }

    // Scheduled Downgrade Execution on period end
    const scheduledTargetPlanId =
      sub.scheduledPlanId ||
      (sub.providerPlanId?.startsWith('downgrade_') ? sub.providerPlanId.replace('downgrade_', '') : null);

    if (msLeft < 0 && scheduledTargetPlanId) {
      const targetPlan = await prisma.plan.findUnique({ where: { id: scheduledTargetPlanId } });

      // If Auto-Pay is ON and target plan is a paid plan -> renew at new plan price
      if (sub.autoRenew && targetPlan && targetPlan.priceCents > 0) {
        const isYearly = targetPlan.billingInterval === 'YEAR';
        const newPeriodEnd = new Date(now.getTime() + (isYearly ? 365 : 30) * 24 * 60 * 60 * 1000);

        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            planId: targetPlan.id,
            billingInterval: targetPlan.billingInterval,
            scheduledPlanId: null,
            scheduledChangeAt: null,
            providerPlanId: null,
            currentPeriodStart: now,
            currentPeriodEnd: newPeriodEnd,
            status: 'ACTIVE',
            autoRenew: true,
          },
        });

        await prisma.subscriptionEvent.create({
          data: {
            subscriptionId: sub.id,
            eventType: 'ACTIVATED',
            provider: sub.provider,
            occurredAt: now,
            payload: {
              action: 'DOWNGRADE_EXECUTED',
              previousPlanId: sub.planId,
              newPlanId: targetPlan.id,
            },
          },
        });

        continue;
      } else {
        // One-time payment ended OR downgraded to Free tier -> Expire subscription to Free tier
        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            status: 'EXPIRED',
            scheduledPlanId: null,
            scheduledChangeAt: null,
            providerPlanId: null,
            endedAt: sub.endedAt || now,
            autoRenew: false,
            cancelAtPeriodEnd: false,
          },
        });

        expiredSubscriptions++;

        // Send expiry / prompt notification
        try {
          const logTitle = `BILLING_DOWNGRADE_EXPIRED_${sub.id}`;
          await sendNotification(
            sub.userId,
            targetPlan && targetPlan.priceCents > 0
              ? `Your ${sub.plan.name} plan ended — ready to switch to ${targetPlan.name}?`
              : `Your ${sub.plan.name} access ended`,
            targetPlan && targetPlan.priceCents > 0
              ? `Your one-time ${sub.plan.name} period has ended. Visit billing to complete your payment for ${targetPlan.name}.`
              : `Your ${sub.plan.name} plan expired on ${sub.currentPeriodEnd.toLocaleDateString('en-IN')}. Your account is now on the Free tier.`,
            ['EMAIL'],
            undefined,
            {
              logTitle,
              emailSubject: targetPlan && targetPlan.priceCents > 0
                ? `Activate your ${targetPlan.name} plan`
                : `${sub.plan.name} access ended`,
              html: renderSubscriptionExpired({
                planName: sub.plan.name,
                expiryDate: sub.currentPeriodEnd.toLocaleDateString('en-IN'),
                statusText: targetPlan && targetPlan.priceCents > 0
                  ? `One-time access ended. Ready to activate ${targetPlan.name}`
                  : 'Account returned to free tier',
              }),
            }
          );
        } catch (err) {
          console.warn('[Billing] Failed to send downgrade expiry email:', err);
        }

        continue;
      }
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
              html: renderSubscriptionExpired({
                planName: sub.plan.name,
                expiryDate: sub.currentPeriodEnd.toLocaleDateString('en-IN'),
                statusText: sub.providerSubscriptionId.startsWith('local_') ? 'Local billing expired' : 'Waiting for renewal confirmation',
              }),
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

export async function scheduleDowngradeSubscription(params: {
  userId: string;
  targetPlanId: string;
}) {
  const targetPlan = await prisma.plan.findUnique({ where: { id: params.targetPlanId } });
  if (!targetPlan) {
    throw createError(404, 'PLAN_NOT_FOUND', 'Target plan not found');
  }

  const activeSub = await prisma.subscription.findFirst({
    where: {
      userId: params.userId,
      status: 'ACTIVE',
    },
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!activeSub) {
    throw createError(400, 'NO_ACTIVE_SUBSCRIPTION', 'No active subscription found to downgrade');
  }

  if (targetPlan.priceCents >= activeSub.plan.priceCents) {
    throw createError(400, 'INVALID_DOWNGRADE', 'Target plan must be a lower tier than your current plan');
  }

  const isPaidTarget = targetPlan.priceCents > 0;
  const isRealRazorpay = Boolean(activeSub.providerSubscriptionId && activeSub.providerSubscriptionId.startsWith('sub_'));

  if (isPaidTarget) {
    // Paid -> Paid downgrade: Use Razorpay's native schedule_change_at: 'cycle_end'
    if (isRealRazorpay) {
      const providerPlan = await ensureRazorpayPlanForPlan(targetPlan.id);
      await updateRazorpaySubscription(activeSub.providerSubscriptionId, {
        planId: providerPlan.providerPlanId,
        scheduleChangeAt: 'cycle_end',
        customerNotify: 1,
      });
    }

    const updatedSub = await prisma.subscription.update({
      where: { id: activeSub.id },
      data: {
        scheduledPlanId: targetPlan.id,
        scheduledChangeAt: activeSub.currentPeriodEnd,
        providerPlanId: null,
        cancelAtPeriodEnd: false,
      },
    });

    await prisma.subscriptionEvent.create({
      data: {
        subscriptionId: activeSub.id,
        eventType: 'ACTIVATED',
        provider: activeSub.provider,
        occurredAt: new Date(),
        payload: {
          action: 'SCHEDULE_DOWNGRADE',
          previousPlanId: activeSub.planId,
          targetPlanId: targetPlan.id,
          targetPlanName: targetPlan.name,
          effectiveDate: activeSub.currentPeriodEnd,
          mode: 'CYCLE_END_PLAN_CHANGE',
        },
      },
    });

    sendNotification(
      activeSub.userId,
      `Plan downgrade scheduled to ${targetPlan.name}`,
      `Your plan will switch to ${targetPlan.name} on ${activeSub.currentPeriodEnd.toLocaleDateString('en-IN')}. All your current features remain active until then.`,
      ['EMAIL'],
      undefined,
      {
        emailSubject: `Plan Downgrade Scheduled: ${targetPlan.name}`,
        html: renderSubscriptionDowngraded({
          currentPlanName: activeSub.plan.name,
          targetPlanName: targetPlan.name,
          periodEnd: activeSub.currentPeriodEnd.toLocaleDateString('en-IN'),
          appUrl: `${env.FRONTEND_URL}/settings?tab=billing`,
        }),
      }
    ).catch((err) => {
      console.warn('[Billing] Failed to send downgrade scheduled email:', err);
    });

    return {
      subscription: updatedSub,
      scheduledDowngradePlan: {
        id: targetPlan.id,
        name: targetPlan.name,
        slug: targetPlan.slug,
        priceCents: targetPlan.priceCents,
        billingInterval: targetPlan.billingInterval,
      },
      effectiveDate: activeSub.currentPeriodEnd,
    };
  } else {
    // Paid -> Free downgrade: Schedule cancellation at cycle end
    if (isRealRazorpay) {
      await cancelRazorpaySubscription(activeSub.providerSubscriptionId, true);
    }

    const updatedSub = await prisma.subscription.update({
      where: { id: activeSub.id },
      data: {
        cancelAtPeriodEnd: true,
        scheduledPlanId: targetPlan.id,
        scheduledChangeAt: activeSub.currentPeriodEnd,
        providerPlanId: null,
      },
    });

    await prisma.subscriptionEvent.create({
      data: {
        subscriptionId: activeSub.id,
        eventType: 'CANCELLED',
        provider: activeSub.provider,
        occurredAt: new Date(),
        payload: {
          action: 'SCHEDULE_DOWNGRADE_TO_FREE',
          previousPlanId: activeSub.planId,
          targetPlanId: targetPlan.id,
          targetPlanName: targetPlan.name,
          effectiveDate: activeSub.currentPeriodEnd,
          mode: 'CYCLE_END_CANCELLATION',
        },
      },
    });

    sendNotification(
      activeSub.userId,
      `Plan downgrade to Free scheduled`,
      `Your paid plan will end on ${activeSub.currentPeriodEnd.toLocaleDateString('en-IN')}. All your current features remain active until then.`,
      ['EMAIL'],
      undefined,
      {
        emailSubject: `Plan Downgrade Scheduled: Free Tier`,
        html: renderSubscriptionDowngraded({
          currentPlanName: activeSub.plan.name,
          targetPlanName: 'Free',
          periodEnd: activeSub.currentPeriodEnd.toLocaleDateString('en-IN'),
          appUrl: `${env.FRONTEND_URL}/settings?tab=billing`,
        }),
      }
    ).catch((err) => {
      console.warn('[Billing] Failed to send downgrade scheduled email:', err);
    });

    return {
      subscription: updatedSub,
      scheduledDowngradePlan: {
        id: targetPlan.id,
        name: targetPlan.name,
        slug: targetPlan.slug,
        priceCents: 0,
        billingInterval: targetPlan.billingInterval,
      },
      effectiveDate: activeSub.currentPeriodEnd,
    };
  }
}

export async function cancelScheduledDowngrade(params: { userId: string }) {
  const activeSub = await prisma.subscription.findFirst({
    where: {
      userId: params.userId,
      status: 'ACTIVE',
      OR: [
        { scheduledPlanId: { not: null } },
        { providerPlanId: { startsWith: 'downgrade_' } },
        { cancelAtPeriodEnd: true },
      ],
    },
    include: { plan: true },
  });

  if (!activeSub) {
    throw createError(400, 'NO_SCHEDULED_DOWNGRADE', 'No scheduled downgrade found on your subscription');
  }

  const isRealRazorpay = Boolean(activeSub.providerSubscriptionId && activeSub.providerSubscriptionId.startsWith('sub_'));

  // If it was a paid -> paid scheduled change, revert Razorpay plan back to activeSub.plan
  if (isRealRazorpay && activeSub.scheduledPlanId) {
    const targetScheduledPlan = await prisma.plan.findUnique({ where: { id: activeSub.scheduledPlanId } });
    if (targetScheduledPlan && targetScheduledPlan.priceCents > 0) {
      const currentProviderPlan = await ensureRazorpayPlanForPlan(activeSub.planId);
      await updateRazorpaySubscription(activeSub.providerSubscriptionId, {
        planId: currentProviderPlan.providerPlanId,
        scheduleChangeAt: 'cycle_end',
        customerNotify: 1,
      }).catch((err) => {
        console.warn('[Billing] Failed to revert Razorpay scheduled plan change:', err);
      });
    }
  }

  const updatedSub = await prisma.subscription.update({
    where: { id: activeSub.id },
    data: {
      scheduledPlanId: null,
      scheduledChangeAt: null,
      providerPlanId: null,
      cancelAtPeriodEnd: false,
    },
  });

  await prisma.subscriptionEvent.create({
    data: {
      subscriptionId: activeSub.id,
      eventType: 'ACTIVATED',
      provider: activeSub.provider,
      occurredAt: new Date(),
      payload: {
        action: 'CANCEL_SCHEDULED_DOWNGRADE',
      },
    },
  });

  return {
    subscription: updatedSub,
    message: 'Scheduled downgrade cancelled. Your subscription will renew at its current plan.',
  };
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
    const nextStart = new Date(sub.currentPeriodEnd);
    const nextEnd = new Date(computeNextCycleTimestamp(plan.billingInterval, nextStart) * 1000);
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
