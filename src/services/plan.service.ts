// backend/src/services/plan.service.ts
// Database-driven plans, entitlements, and Razorpay provider plan versioning.

import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import { logAdminAction } from './audit.service';
import { createRazorpayProviderPlan } from '../providers/razorpay/razorpay.subscription';
import { Prisma } from '@prisma/client';
import type { BillingInterval } from '@prisma/client';


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

  const plan = await prisma.plan.create({
    data: {
      slug,
      name: params.name.trim(),
      description: params.description,
      currency,
      priceCents: params.priceCents,
      billingInterval,
      features: params.features,
      sortOrder: params.sortOrder ?? 0,
      isActive: params.isActive ?? true,
      createdByAdminId: params.adminAccountId,
      version: 1,
    },
  });

  // Create Razorpay provider plan artifact
  try {
    const rzpInterval = billingInterval === 'YEAR' ? 'yearly' : 'monthly';
    const rzpPlan = await createRazorpayProviderPlan({
      name: plan.name,
      amountCents: plan.priceCents,
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
        amountCents: plan.priceCents,
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

  const updated = await prisma.plan.update({
    where: { id },
    data: {
      name: params.name?.trim() ?? existing.name,
      description: params.description !== undefined ? params.description : existing.description,
      currency: params.currency ?? existing.currency,
      priceCents: params.priceCents ?? existing.priceCents,
      billingInterval: params.billingInterval ?? existing.billingInterval,
      features: params.features !== undefined ? (params.features as Prisma.InputJsonValue) : (existing.features as Prisma.InputJsonValue | undefined) ?? undefined,
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
      const rzpPlan = await createRazorpayProviderPlan({
        name: updated.name,
        amountCents: updated.priceCents,
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
          amountCents: updated.priceCents,
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