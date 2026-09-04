// backend/src/services/customPlan.service.ts
// Persistence + business logic for Custom Plan requests.
//
// Key security invariants (see also customPlan.validation.ts):
//  - The caller's user id is taken from the authenticated session, never the body.
//  - The current plan is resolved server-side via resolveEffectivePlan(); the
//    client cannot assert which plan they are on.
//  - Requested features/limits are whitelisted against canonical feature keys.
//  - Duplicate open requests are rejected.
//  - Status transitions are server-controlled (admins only).

import * as crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import { env } from '../config/env';
import { resolveEffectivePlan } from './entitlement.service';
import type { CustomPlanRequestStatus } from '@prisma/client';
import {
  sanitizeRequestedLimits,
  sanitizeRequestedFeatures,
  sanitizeRequirements,
  canTransitionStatus,
  parseBillingInterval,
  normalizeFinalConfig,
  PAY_TOKEN_TTL_MS,
  FEATURE_LABELS,
  MIN_AI_QUOTA,
  type FinalConfigShape,
} from './customPlan.validation';
import { logAdminAction } from './audit.service';
import { sendNotification } from './notification.service';
import { recordSuccessfulPayment, createCheckoutOrder } from './billing.service';
import { verifyRazorpayPaymentSignature } from '../providers/razorpay/razorpay.payment';
import { sendMail } from '../lib/mailer';
import {
  renderCustomPlanReceived,
  renderCustomPlanQuote,
  renderCustomPlanRejected,
  renderCustomPlanAccepted,
  renderCustomPlanActivated,
  renderCustomPlanAdminNotify,
} from '../lib/mailer';

interface CreateCustomPlanPayload {
  requestedFeatures?: unknown;
  requestedLimits?: unknown;
  requirements?: unknown;
}

const OPEN_STATUSES: CustomPlanRequestStatus[] = ['PENDING', 'REVIEWING', 'QUOTED'];

/** Helper to include the user alongside any request. */
const includeUser = {
  user: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
} as const;

// ─────────────────── Payment-token + entitlement helpers ────────────────────

const CARRIER_GST_PERCENT = 18;

function sha256Hex(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function tokenHashMatches(token: string, expectedHash: string | null | undefined): boolean {
  if (!expectedHash) return false;
  const actual = Buffer.from(sha256Hex(token));
  const expected = Buffer.from(expectedHash);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/** Decodes + verifies the raw payment token. Returns null for anything invalid. */
function decodePayToken(token: string): { uid: string; cpr: string } | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as any;
    if (decoded && typeof decoded.uid === 'string' && typeof decoded.cpr === 'string') {
      return { uid: decoded.uid, cpr: decoded.cpr };
    }
  } catch {
    /* invalid, malformed, or expired token */
  }
  return null;
}

/**
 * Builds the complete, immutable entitlement snapshot for an ACCEPTED custom plan.
 * Starts from the user's effective features at acceptance time and applies the
 * finalized numeric limits + boolean features over it. Never recalculated later —
 * it is stored once on the carrier Plan.features.
 */
export function buildCustomPlanFeaturesSnapshot(
  baseFeatures: Record<string, any>,
  config: FinalConfigShape
): Record<string, any> {
  const snapshot: Record<string, any> = { ...baseFeatures };
  for (const [key, value] of Object.entries(config.requestedLimits)) snapshot[key] = value;
  for (const [key, enabled] of Object.entries(config.requestedFeatures)) {
    if (enabled) snapshot[key] = true;
  }

  // AI features require a usable AI quota (>= MIN_AI_QUOTA or unlimited -1).
  const hasAI = Boolean(snapshot['aiCoach'] || snapshot['goals']);
  if (hasAI) {
    const quota = snapshot['aiRequestsPerMonth'];
    const usable = quota === -1 || (typeof quota === 'number' && quota >= MIN_AI_QUOTA);
    if (!usable) {
      snapshot['aiRequestsPerMonth'] = MIN_AI_QUOTA;
    }
  }

  return snapshot;
}

/** Resolves the admin-authored finalConfig, falling back to the original request. */
function resolveFinalConfigForAcceptance(request: any): FinalConfigShape {
  const fc = normalizeFinalConfig(request.finalConfig);
  if (Object.keys(fc.requestedLimits).length > 0 || Object.keys(fc.requestedFeatures).length > 0) {
    return fc;
  }
  return {
    requestedLimits: sanitizeRequestedLimits(request.requestedLimits),
    requestedFeatures: normalizeFinalConfig({ requestedFeatures: request.requestedFeatures }).requestedFeatures,
  };
}

/**
 * Creates (idempotently) the hidden carrier Plan for an ACCEPTED custom plan.
 * Carries the immutable entitlement snapshot, quoted pre-GST price, and GST, and
 * is marked isActive:false so it never appears in pricing / Admin → Plans.
 */
async function findOrCreateCarrierPlan(
  tx: Prisma.TransactionClient,
  request: any,
  fc: FinalConfigShape
) {
  const slug = `custom-${request.id.slice(-16).toLowerCase()}`;
  const existing = await tx.plan.findUnique({ where: { slug } });
  if (existing) return existing;

  const effective = await resolveEffectivePlan(request.userId);
  const snapshot = buildCustomPlanFeaturesSnapshot(
    (effective.features as Record<string, any>) || {},
    fc
  );

  return tx.plan.create({
    data: {
      slug,
      name: 'Custom Plan',
      description: 'Custom plan tailored for your account',
      currency: request.currency || 'INR',
      priceCents: request.quotedPriceCents ?? 0,
      gstPercent: CARRIER_GST_PERCENT,
      billingInterval: request.billingInterval ?? 'MONTH',
      features: snapshot as any,
      sortOrder: 99999,
      isActive: false,
      metadata: { source: 'CUSTOM_PLAN', customPlanRequestId: request.id },
    },
  });
}

async function safeNotify(userId: string, title: string, body: string, emailSubject: string, html: string) {
  try {
    await sendNotification(userId, title, body, ['EMAIL'], undefined, { emailSubject, html });
  } catch (err) {
    console.warn('[CustomPlan] Email delivery failed:', err);
  }
}

function shortId(id: string): string {
  return id.slice(-6).toUpperCase();
}

function priceLabel(cents: number | null, billingInterval?: string | null): string {
  if (cents == null) return '';
  const amount = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    cents / 100
  );
  const per = billingInterval === 'YEAR' ? ' / year' : billingInterval === 'MONTH' ? ' / month' : '';
  return `${amount}${per}`;
}

async function notifyRequestReceived(request: any) {
  const id = shortId(request.id);
  await safeNotify(
    request.userId,
    'We received your custom plan request',
    `Your request #${id} has been received. Our team will review it and prepare a quote.`,
    `We received your custom plan request (#${id})`,
    renderCustomPlanReceived({ requestId: id, name: request.user?.name || '' })
  );
}

/** Emails the admin team when a new custom plan request is submitted. */
async function notifyAdminOfNewRequest(request: any) {
  const id = shortId(request.id);
  const limits = (request.requestedLimits || {}) as Record<string, number>;
  const features = (request.requestedFeatures || {}) as Record<string, boolean>;
  const reqs = (request.requirements || {}) as Record<string, string>;

  const limitsSummary = Object.entries(limits)
    .map(([k, v]) => `${FEATURE_LABELS[k] || k}: ${v === -1 ? 'Unlimited' : v}`)
    .join(', ');
  const featuresSummary = Object.keys(features)
    .map((k) => FEATURE_LABELS[k] || k)
    .join(', ');
  const requirements = [reqs.goal, reqs.hurdles, reqs.otherNotes].filter(Boolean).join(' · ');

  try {
    await sendMail({
      to: env.ADMIN_EMAIL,
      subject: `New custom plan request #${id}`,
      html: renderCustomPlanAdminNotify({
        requestId: id,
        customerName: request.user?.name || '—',
        customerEmail: request.user?.email || '—',
        limitsSummary,
        featuresSummary,
        requirements,
        adminUrl: `${env.FRONTEND_URL}/admin/custom-plans`,
      }),
    });
  } catch (err) {
    console.warn('[CustomPlan] Failed to notify admin of new request:', err);
  }
}

async function notifyQuote(request: any) {
  const id = shortId(request.id);
  const label = priceLabel(request.quotedPriceCents, request.billingInterval);
  const intervalLabel = request.billingInterval === 'YEAR' ? 'Annual' : request.billingInterval === 'MONTH' ? 'Monthly' : '';
  await safeNotify(
    request.userId,
    'Your custom plan quote',
    `Your custom plan quote (${label}) is almost ready. You'll receive your payment link by email shortly.`,
    `Your custom plan quote (#${id})`,
    renderCustomPlanQuote({
      requestId: id,
      priceLabel: label || '—',
      intervalLabel,
    })
  );
}

async function notifyRejected(request: any) {
  const id = shortId(request.id);
  await safeNotify(
    request.userId,
    'Your custom plan request',
    `We couldn't accommodate your custom plan request at this time.`,
    `Update on your custom plan request (#${id})`,
    renderCustomPlanRejected({ requestId: id, reason: request.adminNotes || '' })
  );
}

async function notifyAccepted(request: any, payLink: string | null, _carrierPlan: any) {
  const id = shortId(request.id);
  const intervalLabel = request.billingInterval === 'YEAR' ? 'Annual' : 'Monthly';
  await safeNotify(
    request.userId,
    'Your custom plan is ready to activate',
    `Your custom plan is ready. Open the link in this email to review it and pay to activate your features.`,
    `Your custom plan is ready to activate (#${id})`,
    renderCustomPlanAccepted({
      requestId: id,
      payUrl: payLink || `${env.FRONTEND_URL}/custom-plan`,
      priceLabel: priceLabel(request.quotedPriceCents, request.billingInterval),
      intervalLabel,
    })
  );
}

async function notifyActivated(request: any, _carrierPlan: any) {
  const id = shortId(request.id);
  await safeNotify(
    request.userId,
    'Your custom plan is active',
    `Your custom plan is now active — your new limits and features have been unlocked.`,
    `Your custom plan is active (#${id})`,
    renderCustomPlanActivated({ requestId: id })
  );
}

// ─────────────────────────────── Creation ──────────────────────────────────

export async function createCustomPlanRequest(
  userId: string,
  payload: CreateCustomPlanPayload
) {
  // Resolve the real effective plan (override → subscription → free).
  const effective = await resolveEffectivePlan(userId);

  const currentFeatures = (effective.features as Record<string, unknown>) || {};

  // Validate BEFORE persisting anything.
  const requestedLimits = sanitizeRequestedLimits(payload.requestedLimits);
  const requestedFeatures = sanitizeRequestedFeatures(payload.requestedFeatures, currentFeatures);
  const requirements = sanitizeRequirements(payload.requirements);

  if (
    Object.keys(requestedLimits).length === 0 &&
    Object.keys(requestedFeatures).length === 0 &&
    !requirements.goal &&
    !requirements.hurdles &&
    !requirements.otherNotes
  ) {
    throw createError(400, 'EMPTY_REQUEST', 'Please provide at least one requested change or note.');
  }

  // Prevent duplicate / concurrent open requests.
  const existingOpen = await prisma.customPlanRequest.findFirst({
    where: { userId, status: { in: OPEN_STATUSES } },
    select: { id: true, status: true },
  });
  if (existingOpen) {
    throw createError(409, 'CUSTOM_PLAN_REQUEST_EXISTS', 'You already have an open custom plan request under review.');
  }

  const created = await prisma.customPlanRequest.create({
    data: {
      userId,
      currentPlanId: effective.planId,
      status: 'PENDING',
      requestedFeatures: requestedFeatures as any,
      requestedLimits: requestedLimits as any,
      requirements: (requirements as any) ?? undefined,
      currency: 'INR',
    },
    include: includeUser,
  });

  await notifyRequestReceived(created);
  await notifyAdminOfNewRequest(created);
  return created;
}

export async function listMyCustomPlanRequests(userId: string) {
  return prisma.customPlanRequest.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
}

export async function getMyCustomPlanRequest(userId: string, id: string) {
  const request = await prisma.customPlanRequest.findFirst({
    where: { id, userId },
    include: includeUser,
  });
  if (!request) {
    throw createError(404, 'CUSTOM_PLAN_NOT_FOUND', 'Custom plan request not found.');
  }
  return request;
}
// ─────────────────────────────── Admin ────────────────────────────────────────

export interface AdminListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: CustomPlanRequestStatus | 'ALL';
}

export async function listCustomPlanRequestsAdmin(params: AdminListParams) {
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
  const where: any = {};

  if (params.status && params.status !== 'ALL') {
    where.status = params.status;
  }
  if (params.search?.trim()) {
    const q = params.search.trim();
    where.user = {
      OR: [
        { email: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { id: { equals: q } },
      ],
    };
  }

  const [total, items] = await Promise.all([
    prisma.customPlanRequest.count({ where }),
    prisma.customPlanRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { id: true, email: true, name: true } } },
    }),
  ]);

  return { page, pageSize, total, items };
}

/** Counts actionable (open) custom-plan requests awaiting admin attention. */
export async function countOpenCustomPlanRequestsAdmin(): Promise<number> {
  return prisma.customPlanRequest.count({
    where: { status: { in: OPEN_STATUSES } },
  });
}

export async function getCustomPlanRequestAdmin(id: string) {
  const request = await prisma.customPlanRequest.findUnique({
    where: { id },
    include: includeUser,
  });
  if (!request) {
    throw createError(404, 'CUSTOM_PLAN_NOT_FOUND', 'Custom plan request not found.');
  }
  return request;
}

export interface AdminUpdatePayload {
  status?: CustomPlanRequestStatus;
  adminNotes?: string | null;
  quotedPriceCents?: number | null;
  billingInterval?: 'MONTH' | 'YEAR';
  finalConfig?: Record<string, any> | null;
}

export async function updateCustomPlanRequestAdmin(
  id: string,
  payload: AdminUpdatePayload,
  adminAccountId: string
) {
  const existing = await prisma.customPlanRequest.findUnique({
    where: { id },
    include: includeUser,
  });
  if (!existing) {
    throw createError(404, 'CUSTOM_PLAN_NOT_FOUND', 'Custom plan request not found.');
  }

  const data: any = {};
  let transitionedTo: CustomPlanRequestStatus | null = null;

  if (payload.status !== undefined) {
    if (!canTransitionStatus(existing.status, payload.status)) {
      throw createError(
        409,
        'INVALID_STATUS_TRANSITION',
        `Cannot move request from ${existing.status} to ${payload.status}.`
      );
    }
    data.status = payload.status;
    data.reviewedAt = new Date();
    data.adminReviewerId = adminAccountId;
    transitionedTo = payload.status;
  }

  if (payload.adminNotes !== undefined) {
    data.adminNotes = payload.adminNotes ?? null;
  }
  if (payload.quotedPriceCents !== undefined) {
    data.quotedPriceCents = payload.quotedPriceCents ?? null;
  }
  if (payload.billingInterval !== undefined) {
    data.billingInterval = parseBillingInterval(payload.billingInterval);
  }

  // finalConfig is normalized server-side; it is the immutable snapshot input
  // applied once when the request reaches ACCEPTED.
  let finalConfigUpdated: FinalConfigShape | null = null;
  if (payload.finalConfig !== undefined) {
    if (payload.finalConfig == null) {
      data.finalConfig = null;
    } else {
      finalConfigUpdated = normalizeFinalConfig(payload.finalConfig);
      data.finalConfig = finalConfigUpdated as any;
    }
  }

  if (Object.keys(data).length === 0) {
    throw createError(400, 'NO_UPDATES', 'No valid fields provided to update.');
  }

  const isAccept = transitionedTo === 'ACCEPTED';
  let payLink: string | null = null;
  let carrierPlan: any = null;

  const updated = await prisma.$transaction(async (tx) => {
    const updatedReq = await tx.customPlanRequest.update({
      where: { id },
      data,
      include: includeUser,
    });

    if (isAccept) {
      // Idempotent finalization: reuse an existing carrier plan + pay token when
      // the ACCEPTED transition is retried (e.g. a duplicate admin PATCH).
      const fc = finalConfigUpdated ?? resolveFinalConfigForAcceptance(updatedReq);
      carrierPlan = await findOrCreateCarrierPlan(tx, updatedReq, fc);

      const tokenNeedsRefresh =
        !updatedReq.payTokenHash ||
        !updatedReq.payTokenExpiresAt ||
        updatedReq.payTokenExpiresAt.getTime() < Date.now();

      if (updatedReq.carrierPlanId !== carrierPlan.id || tokenNeedsRefresh) {
        let hash = updatedReq.payTokenHash ?? null;
        let expiresAt = updatedReq.payTokenExpiresAt ?? null;
        if (tokenNeedsRefresh) {
          const rawToken = jwt.sign(
            { uid: updatedReq.userId, cpr: updatedReq.id },
            env.JWT_SECRET,
            { expiresIn: '7d' }
          );
          hash = sha256Hex(rawToken);
          expiresAt = new Date(Date.now() + PAY_TOKEN_TTL_MS);
          payLink = `${env.FRONTEND_URL}/custom-plan/${rawToken}`;
        }
        await tx.customPlanRequest.update({
          where: { id },
          data: { carrierPlanId: carrierPlan.id, payTokenHash: hash, payTokenExpiresAt: expiresAt },
        });
      }

      const latest = await tx.customPlanRequest.findUniqueOrThrow({
        where: { id },
        include: includeUser,
      });

      await logAdminAction({
        adminAccountId,
        action: 'CUSTOM_PLAN_UPDATED',
        entityType: 'CustomPlanRequest',
        entityId: latest.id,
        before: {
          status: existing.status,
          adminNotes: existing.adminNotes,
          quotedPriceCents: existing.quotedPriceCents,
        },
        after: {
          status: latest.status,
          adminNotes: latest.adminNotes,
          quotedPriceCents: latest.quotedPriceCents,
          carrierPlanId: carrierPlan.id,
        },
      });

      return latest;
    }

    await logAdminAction({
      adminAccountId,
      action: 'CUSTOM_PLAN_UPDATED',
      entityType: 'CustomPlanRequest',
      entityId: updatedReq.id,
      before: {
        status: existing.status,
        adminNotes: existing.adminNotes,
        quotedPriceCents: existing.quotedPriceCents,
      },
      after: {
        status: updatedReq.status,
        adminNotes: updatedReq.adminNotes,
        quotedPriceCents: updatedReq.quotedPriceCents,
      },
    });

    return updatedReq;
  });

  // Email delivery happens outside the DB transaction — failures must not roll
  // back the persisted state transition.
  if (transitionedTo === 'QUOTED') {
    await notifyQuote(updated);
  } else if (transitionedTo === 'REJECTED') {
    await notifyRejected(updated);
  } else if (transitionedTo === 'ACCEPTED' && payLink) {
    // Only email the pay link when a fresh token was generated. An idempotent
    // re-accept (carrier plan + token already exist) must NOT resend a broken or
    // duplicate activation email.
    await notifyAccepted(updated, payLink, carrierPlan);
  }

  return updated;
}

// ───────────────────────── Pay-by-token (self-service) ──────────────────────

/**
 * Resolves + validates the emailed payment token for the signed-in user and
 * returns the tailored custom plan they can pay for. `paidAt` indicates an
 * already-activated plan (repeat visits short-circuit idempotently).
 */
export async function getCustomPlanPay(token: string, userId: string) {
  const payload = decodePayToken(token);
  if (!payload) {
    throw createError(400, 'INVALID_OR_EXPIRED_PAY_TOKEN', 'This payment link is invalid or has expired.');
  }

  const request = await prisma.customPlanRequest.findUnique({
    where: { id: payload.cpr },
    include: includeUser,
  });
  if (!request || request.userId !== userId) {
    throw createError(404, 'CUSTOM_PLAN_NOT_FOUND', 'Custom plan request not found.');
  }
  if (!tokenHashMatches(token, request.payTokenHash)) {
    throw createError(400, 'INVALID_PAY_TOKEN', 'This payment link is invalid or has expired.');
  }
  if (request.payTokenExpiresAt && request.payTokenExpiresAt.getTime() < Date.now()) {
    throw createError(410, 'PAY_TOKEN_EXPIRED', 'This payment link has expired. Contact support to receive a new one.');
  }
  if (request.status !== 'ACCEPTED') {
    throw createError(409, 'REQUEST_NOT_ACCEPTED', 'This custom plan is not ready for payment yet.');
  }

  const carrierPlan = request.carrierPlanId
    ? await prisma.plan.findUnique({ where: { id: request.carrierPlanId } })
    : null;
  if (!carrierPlan) {
    throw createError(409, 'CARRIER_PLAN_MISSING', 'The custom plan is not fully prepared yet.');
  }

  return {
    request,
    carrierPlan,
    alreadyPaid: !!request.paidAt,
    priceCents: carrierPlan.priceCents,
    currency: carrierPlan.currency,
    gstPercent: carrierPlan.gstPercent,
    billingInterval: carrierPlan.billingInterval,
    features: (carrierPlan.features as Record<string, any>) || {},
  };
}

/** Idempotently creates the checkout order for the accepted custom plan. */
export async function createCustomPlanPaymentOrder(token: string, userId: string) {
  const info = await getCustomPlanPay(token, userId);
  if (info.alreadyPaid) {
    throw createError(409, 'ALREADY_PAID', 'This custom plan has already been paid and activated.');
  }
  return createCheckoutOrder({
    userId,
    planId: info.carrierPlan.id,
    type: 'ONE_TIME',
    idempotencyKey: `custom-plan-${info.request.id}`,
    allowInactive: true,
  });
}

/**
 * Verifies a Razorpay payment for the accepted custom plan and activates the
 * entitlements through the existing recordSuccessfulPayment path (idempotent on
 * payment id + reused ACTIVE subscription). Marks paidAt and emails on first pay.
 */
export async function verifyCustomPlanPayment(
  token: string,
  userId: string,
  verification: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }
) {
  const info = await getCustomPlanPay(token, userId);
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = verification;

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

  const order = await prisma.paymentOrder.findFirst({
    where: { providerOrderId: razorpayOrderId, userId },
    include: { plan: true },
  });
  if (!order) {
    throw createError(404, 'ORDER_NOT_FOUND', 'Matching payment order was not found.');
  }

  // Creates/activates the subscription + invoice atomically. Idempotent: dupes
  // are rejected by payment id and an existing ACTIVE subscription is reused.
  const tx = await recordSuccessfulPayment({
    userId,
    provider: 'razorpay',
    providerPaymentId: razorpayPaymentId,
    providerOrderId: razorpayOrderId,
    amountCents: order.totalCents,
    currency: order.currency,
    orderId: order.id,
    planId: order.planId || undefined,
    subtotalCents: order.subtotalCents,
    taxCents: order.taxCents,
    autoRenew: false,
    metadata: { verifiedVia: 'CUSTOM_PLAN_PAY', customPlanRequestId: info.request.id },
  });

  // Mark paid + send activated email exactly once.
  if (!info.request.paidAt) {
    await prisma.customPlanRequest.update({
      where: { id: info.request.id },
      data: { paidAt: new Date() },
    });
    await notifyActivated(info.request, info.carrierPlan);
  }

  return tx;
}