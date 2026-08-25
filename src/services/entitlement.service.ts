// backend/src/services/entitlement.service.ts
// Central authority for resolving user entitlements with strict hierarchical precedence.

import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';

export interface EffectivePlanResult {
  planId: string | null;
  planName: string;
  planSlug: string;
  source: 'ADMIN_OVERRIDE' | 'SUBSCRIPTION' | 'FREE';
  status: 'ACTIVE' | 'PAST_DUE' | 'FREE' | 'INACTIVE';
  features: Record<string, any>;
  expiresAt?: Date | null;
  subscriptionId?: string | null;
  overrideId?: string | null;
}

const DEFAULT_FREE_FEATURES: Record<string, any> = {
  aiRequestsPerMonth: 50,
  projects: 3,
  habits: 5,
  tasks: 100,
  storageMb: 100,
};

/**
 * Resolves the effective plan and entitlement features for a user.
 * Strict Precedence:
 * 1. User Status Check: BANNED/DEACTIVATED -> Zero Access / Throws error.
 * 2. Active Admin Override (startsAt <= now <= endsAt, unrevoked).
 * 3. Active / Grace-Period Paid Subscription.
 * 4. Free / Default Tier.
 */
export async function resolveEffectivePlan(userId: string): Promise<EffectivePlanResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      status: true,
      statusReason: true,
      entitlementOverrides: {
        where: {
          revokedAt: null,
          startsAt: { lte: new Date() },
          OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { plan: true },
      },
      subscriptions: {
        where: {
          status: { in: ['ACTIVE', 'PAST_DUE'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { plan: true },
      },
    },
  });

  if (!user) {
    throw createError(404, 'USER_NOT_FOUND', 'User does not exist');
  }

  if (user.status === 'BANNED') {
    throw createError(403, 'ACCOUNT_BANNED', user.statusReason || 'User account is permanently banned');
  }

  if (user.status === 'DEACTIVATED') {
    throw createError(403, 'ACCOUNT_DEACTIVATED', 'User account is deactivated');
  }

  // Precedence 1: Admin Override
  if (user.entitlementOverrides.length > 0) {
    const override = user.entitlementOverrides[0];
    return {
      planId: override.plan.id,
      planName: override.plan.name,
      planSlug: override.plan.slug,
      source: 'ADMIN_OVERRIDE',
      status: 'ACTIVE',
      features: (override.plan.features as Record<string, any>) || {},
      expiresAt: override.endsAt,
      overrideId: override.id,
    };
  }

  // Precedence 2: Active Paid Subscription
  if (user.subscriptions.length > 0) {
    const sub = user.subscriptions[0];
    const now = new Date();
    // Allow past due within grace period
    const isActive = sub.status === 'ACTIVE' || (sub.status === 'PAST_DUE' && sub.currentPeriodEnd >= now);

    if (isActive) {
      return {
        planId: sub.plan.id,
        planName: sub.plan.name,
        planSlug: sub.plan.slug,
        source: 'SUBSCRIPTION',
        status: sub.status === 'ACTIVE' ? 'ACTIVE' : 'PAST_DUE',
        features: (sub.plan.features as Record<string, any>) || {},
        expiresAt: sub.currentPeriodEnd,
        subscriptionId: sub.id,
      };
    }
  }

  // Precedence 3: Free Tier
  const freePlan = await prisma.plan.findUnique({ where: { slug: 'free' } });

  return {
    planId: freePlan ? freePlan.id : null,
    planName: freePlan ? freePlan.name : 'Free',
    planSlug: freePlan ? freePlan.slug : 'free',
    source: 'FREE',
    status: 'FREE',
    features: (freePlan?.features as Record<string, any>) || DEFAULT_FREE_FEATURES,
    expiresAt: null,
  };
}

/**
 * Checks if a user has access to a feature or quota.
 */
export async function checkUserEntitlement(
  userId: string,
  featureKey: string,
  requiredQuantity: number = 1
): Promise<{ allowed: boolean; limit: number | boolean; currentEffectivePlan: string }> {
  const plan = await resolveEffectivePlan(userId);
  const featureVal = plan.features[featureKey];

  if (featureVal === undefined) {
    return { allowed: false, limit: false, currentEffectivePlan: plan.planName };
  }

  if (typeof featureVal === 'boolean') {
    return { allowed: featureVal, limit: featureVal, currentEffectivePlan: plan.planName };
  }

  if (typeof featureVal === 'number') {
    return {
      allowed: featureVal >= requiredQuantity,
      limit: featureVal,
      currentEffectivePlan: plan.planName,
    };
  }

  return { allowed: true, limit: featureVal, currentEffectivePlan: plan.planName };
}