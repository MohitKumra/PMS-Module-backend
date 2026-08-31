// backend/src/services/plan.service.ts
// Database-driven plans, entitlements, and Razorpay provider plan versioning.

import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import { logAdminAction } from './audit.service';
import { createRazorpayProviderPlan } from '../providers/razorpay/razorpay.subscription';
import { Prisma } from '@prisma/client';
import type { BillingInterval } from '@prisma/client';
import { MIN_AI_QUOTA } from '../config/featureCatalog';

// Clamp an admin-supplied GST percentage to a sane 0–100 range, defaulting to 18.
function clampGst(value?: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, Math.round(value)));
  }
  return 18;
}

/**
 * AI entitlements are only usable when the plan carries a positive AI quota.
 * If a plan enables any AI feature but the quota is missing/below the minimum,
 * auto-raise it so the advertised AI actually works (otherwise every AI call
 * would be rejected server-side).
 */
function enforceAiQuota(features: Record<string, any>): void {
  const hasAI =
    typeof features['aiCoach'] === 'boolean' ||
    typeof features['goals'] === 'boolean';
  if (!hasAI) return;
  const quota = features['aiRequestsPerMonth'];
  const usable = quota === -1 || (typeof quota === 'number' && quota >= MIN_AI_QUOTA);
  if (!usable) {
    features['aiRequestsPerMonth'] = MIN_AI_QUOTA;
  }
}


export async function listPlans(includeInactive: boolean = false) {
  return prisma.plan.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { sortOrder: 'asc' },
    include: {
      paymentProviderPlans: {
        where: { isActive: true },
      },
    },
  });
}

export async function getPlanById(id: string) {
  const plan = await prisma.plan.findUnique({
    where: { id },
    include: { paymentProviderPlans: true },
  });
  if (!plan) throw createError(404, 'PLAN_NOT_FOUND', 'Plan not found');
  return plan;
}

export async function getPlanBySlug(slug: string) {
  const plan = await prisma.plan.findUnique({
    where: { slug: slug.toLowerCase() },
    include: {
      paymentProviderPlans: { where: { isActive: true } },
    },
  });
  if (!plan) throw createError(404, 'PLAN_NOT_FOUND', 'Plan not found');
  return plan;
}

export async function createPlan(params: {
  slug: string;
  name: string;
  description?: string;
  currency?: string;
  priceCents: number;
  gstPercent?: number;
  billingInterval?: BillingInterval;
  features: Record<string, any>;
  sortOrder?: number;
  isActive?: boolean;
  adminAccountId?: string;
}) {
  const slug = params.slug.trim().toLowerCase();
  const existing = await prisma.plan.findUnique({ where: { slug } });
  if (existing) {
    throw createError(409, 'SLUG_IN_USE', 'A plan with this slug already exists.');
  }

  const currency = params.currency || 'USD';
  const billingInterval = params.billingInterval || 'MONTH';
  const gstPercent = clampGst(params.gstPercent);

  const planFeatures: Record<string, any> = { ...params.features };
  enforceAiQuota(planFeatures);

  const plan = await prisma.plan.create({
    data: {
      slug,
      name: params.name.trim(),
      description: params.description,
      currency,
      priceCents: params.priceCents,
      gstPercent,
      billingInterval,
      features: planFeatures,
      sortOrder: params.sortOrder ?? 0,
      isActive: params.isActive ?? true,
      createdByAdminId: params.adminAccountId,
      version: 1,
    },
  });

  // Create Razorpay provider plan artifact. GST applies to recurring charges too,
  // so the provider plan amount is the GST-inclusive price.
  try {
    const rzpInterval = billingInterval === 'YEAR' ? 'yearly' : 'monthly';
    const gstInclusivePrice = plan.priceCents + Math.round((plan.priceCents * plan.gstPercent) / 100);
    const rzpPlan = await createRazorpayProviderPlan({
      name: plan.name,
      amountCents: gstInclusivePrice,
      currency: plan.currency,
      interval: rzpInterval,
      description: plan.description || undefined,
    });

    await prisma.paymentProviderPlan.create({
      data: {
        planId: plan.id,
        provider: 'razorpay',
        providerPlanId: rzpPlan.id,
        currency: plan.currency,
        amountCents: gstInclusivePrice,
        billingInterval: plan.billingInterval,
        isActive: true,
      },
    });
  } catch (err) {
    console.warn('[PlanService] Razorpay provider plan generation deferred:', err);
  }

  if (params.adminAccountId) {
    await logAdminAction({
      adminAccountId: params.adminAccountId,
      action: 'PLAN_CREATED',
      entityType: 'Plan',
      entityId: plan.id,
      after: plan,
    });
  }

  return getPlanById(plan.id);
}

export async function updatePlan(
  id: string,
  params: {
    name?: string;
    description?: string;
    priceCents?: number;
    gstPercent?: number;
    currency?: string;
    billingInterval?: BillingInterval;
    features?: Record<string, any>;
    sortOrder?: number;
    isActive?: boolean;
    adminAccountId?: string;
  }
) {
  const existing = await prisma.plan.findUnique({ where: { id } });
  if (!existing) throw createError(404, 'PLAN_NOT_FOUND', 'Plan not found');

  const priceChanged =
    params.priceCents !== undefined && params.priceCents !== existing.priceCents;
  const intervalChanged =
    params.billingInterval !== undefined && params.billingInterval !== existing.billingInterval;

  const newVersion = priceChanged || intervalChanged ? existing.version + 1 : existing.version;

  // Apply AI-quota guard when features are being updated.
  const planFeatures: Record<string, any> =
    params.features !== undefined
      ? { ...params.features }
      : ((existing.features as Record<string, any>) ?? {});
  if (params.features !== undefined) enforceAiQuota(planFeatures);

  const updated = await prisma.plan.update({
    where: { id },
    data: {
      name: params.name?.trim() ?? existing.name,
      description: params.description !== undefined ? params.description : existing.description,
      currency: params.currency ?? existing.currency,
      priceCents: params.priceCents ?? existing.priceCents,
      gstPercent: params.gstPercent !== undefined ? clampGst(params.gstPercent) : existing.gstPercent,
      billingInterval: params.billingInterval ?? existing.billingInterval,
      features: planFeatures && Object.keys(planFeatures).length ? (planFeatures as Prisma.InputJsonValue) : (existing.features as Prisma.InputJsonValue | undefined) ?? undefined,
      sortOrder: params.sortOrder ?? existing.sortOrder,
      isActive: params.isActive !== undefined ? params.isActive : existing.isActive,
      version: newVersion,
      updatedByAdminId: params.adminAccountId,
    },
  });

  // If price or interval changed, create a new provider plan version rather than modifying existing ones
  if (priceChanged || intervalChanged) {
    try {
      // Retire previous active provider plans for new subscribers
      await prisma.paymentProviderPlan.updateMany({
        where: { planId: id, provider: 'razorpay', isActive: true },
        data: { isActive: false, retiredAt: new Date() },
      });

      const rzpInterval = updated.billingInterval === 'YEAR' ? 'yearly' : 'monthly';
      const gstInclusivePrice = updated.priceCents + Math.round((updated.priceCents * updated.gstPercent) / 100);
      const rzpPlan = await createRazorpayProviderPlan({
        name: updated.name,
        amountCents: gstInclusivePrice,
        currency: updated.currency,
        interval: rzpInterval,
        description: updated.description || undefined,
      });

      await prisma.paymentProviderPlan.create({
        data: {
          planId: updated.id,
          provider: 'razorpay',
          providerPlanId: rzpPlan.id,
          currency: updated.currency,
          amountCents: gstInclusivePrice,
          billingInterval: updated.billingInterval,
          isActive: true,
        },
      });
    } catch (err) {
      console.warn('[PlanService] Failed to create new Razorpay provider plan version:', err);
    }
  }

  if (params.adminAccountId) {
    await logAdminAction({
      adminAccountId: params.adminAccountId,
      action: 'PLAN_UPDATED',
      entityType: 'Plan',
      entityId: updated.id,
      before: existing,
      after: updated,
    });
  }

  return getPlanById(updated.id);
}