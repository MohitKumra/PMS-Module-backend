// backend/src/services/adminUser.service.ts
// Administration service for querying, searching, deactivating, banning, and overriding user entitlements.

import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import { logAdminAction } from './audit.service';
import type { UserStatus, Prisma } from '@prisma/client';

export interface ListUsersParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: UserStatus;
  authProvider?: 'GOOGLE' | 'LOCAL' | 'BOTH';
  planSlug?: string;
  subscriptionStatus?: string;
  startDate?: string;
  endDate?: string;
  sortBy?: 'createdAt' | 'lastLoginAt' | 'email' | 'name';
  sortOrder?: 'asc' | 'desc';
}

export function computeUserLoginMethod(user: { passwordHash: string | null; googleId: string | null }): 'GOOGLE' | 'LOCAL' | 'BOTH' {
  if (user.passwordHash && user.googleId) return 'BOTH';
  if (user.googleId) return 'GOOGLE';
  return 'LOCAL';
}

export async function listAdminUsers(params: ListUsersParams) {
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
  const skip = (page - 1) * pageSize;

  const where: Prisma.UserWhereInput = {};

  if (params.search?.trim()) {
    const q = params.search.trim();
    where.OR = [
      { email: { contains: q, mode: 'insensitive' } },
      { name: { contains: q, mode: 'insensitive' } },
      { id: { equals: q } },
    ];
  }

  if (params.status) {
    where.status = params.status;
  }

  if (params.authProvider === 'GOOGLE') {
    where.googleId = { not: null };
    where.passwordHash = null;
  } else if (params.authProvider === 'LOCAL') {
    where.passwordHash = { not: null };
    where.googleId = null;
  } else if (params.authProvider === 'BOTH') {
    where.googleId = { not: null };
    where.passwordHash = { not: null };
  }

  if (params.planSlug) {
    where.subscriptions = {
      some: {
        plan: { slug: params.planSlug },
        status: { in: ['ACTIVE', 'PAST_DUE'] },
      },
    };
  }

  if (params.subscriptionStatus) {
    where.subscriptions = {
      some: {
        status: params.subscriptionStatus as any,
      },
    };
  }

  if (params.startDate || params.endDate) {
    where.createdAt = {};
    if (params.startDate) where.createdAt.gte = new Date(params.startDate);
    if (params.endDate) where.createdAt.lte = new Date(params.endDate);
  }

  const orderByField = params.sortBy || 'createdAt';
  const orderDirection = params.sortOrder || 'desc';

  const [totalCount, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { [orderByField]: orderDirection },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        passwordHash: true,
        googleId: true,
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'PAST_DUE', 'CREATED'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { plan: { select: { id: true, name: true, slug: true } } },
        },
        billingTransactions: {
          where: { status: 'CAPTURED' },
          select: { netAmountCents: true },
        },
      },
    }),
  ]);

  const items = users.map((u) => {
    const activeSub = u.subscriptions[0];
    const totalSpentCents = u.billingTransactions.reduce((acc, t) => acc + (t.netAmountCents || 0), 0);
    const loginMethod = computeUserLoginMethod(u);

    return {
      id: u.id,
      email: u.email,
      name: u.name,
      avatarUrl: u.avatarUrl,
      status: u.status,
      loginMethod,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      plan: activeSub ? activeSub.plan.name : 'Free',
      planSlug: activeSub ? activeSub.plan.slug : 'free',
      subscriptionStatus: activeSub ? activeSub.status : 'NONE',
      totalSpentCents,
    };
  });

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

export async function getAdminUserDetail(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      subscriptions: {
        orderBy: { createdAt: 'desc' },
        include: {
          plan: true,
          events: { orderBy: { occurredAt: 'desc' }, take: 10 },
        },
      },
      paymentOrders: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { plan: true },
      },
      billingTransactions: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { plan: true, refunds: true },
      },
      invoices: {
        orderBy: { issuedAt: 'desc' },
        take: 20,
      },
      entitlementOverrides: {
        orderBy: { createdAt: 'desc' },
        include: { plan: true },
      },
      loginEvents: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });

  if (!user) {
    throw createError(404, 'USER_NOT_FOUND', 'User does not exist');
  }

  // Financial calculations
  const capturedTx = user.billingTransactions.filter((t) => t.status === 'CAPTURED');
  const grossRevenueCents = capturedTx.reduce((acc, t) => acc + t.grossAmountCents, 0);
  const totalDiscountsCents = capturedTx.reduce((acc, t) => acc + t.discountCents, 0);
  const totalRefundsCents = user.billingTransactions.reduce(
    (acc, t) => acc + t.refunds.filter((r) => r.status === 'PROCESSED').reduce((ra, r) => ra + r.amountCents, 0),
    0
  );
  const netRevenueCents = Math.max(0, grossRevenueCents - totalRefundsCents);

  const activeSub = user.subscriptions.find((s) => s.status === 'ACTIVE' || s.status === 'PAST_DUE');
  const activeOverride = user.entitlementOverrides.find(
    (o) => o.startsAt <= new Date() && (!o.endsAt || o.endsAt > new Date()) && !o.revokedAt
  );

  return {
    identity: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      recoveryEmail: user.recoveryEmail,
      timezone: user.timezone,
      status: user.status,
      statusChangedAt: user.statusChangedAt,
      statusReason: user.statusReason,
      loginMethod: computeUserLoginMethod(user),
      tokenVersion: user.tokenVersion,
      googleId: user.googleId,
      hasPassword: Boolean(user.passwordHash),
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    },
    entitlements: {
      effectivePlan: activeOverride
        ? activeOverride.plan.name
        : activeSub
        ? activeSub.plan.name
        : 'Free',
      hasOverride: Boolean(activeOverride),
      activeOverride,
    },
    financialSummary: {
      grossRevenueCents,
      totalDiscountsCents,
      totalRefundsCents,
      netRevenueCents,
      totalTransactions: user.billingTransactions.length,
    },
    subscriptions: user.subscriptions,
    orders: user.paymentOrders,
    transactions: user.billingTransactions,
    invoices: user.invoices,
    entitlementOverrides: user.entitlementOverrides,
    recentLogins: user.loginEvents,
  };
}

export async function deactivateUser(
  userId: string,
  adminAccountId: string,
  reason?: string
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw createError(404, 'USER_NOT_FOUND', 'User does not exist');
  if (user.status === 'BANNED') {
    throw createError(400, 'USER_BANNED', 'Cannot deactivate a banned user.');
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      status: 'DEACTIVATED',
      statusChangedAt: new Date(),
      statusChangedByAdminId: adminAccountId,
      statusReason: reason || 'Deactivated by administrator',
      tokenVersion: { increment: 1 }, // Invalidate active user sessions
    },
  });

  await logAdminAction({
    adminAccountId,
    action: 'USER_DEACTIVATE',
    entityType: 'User',
    entityId: userId,
    before: { status: user.status },
    after: { status: updated.status, reason },
    reason,
  });

  return updated;
}

export async function reactivateUser(
  userId: string,
  adminAccountId: string,
  reason?: string
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw createError(404, 'USER_NOT_FOUND', 'User does not exist');
  if (user.status === 'BANNED') {
    throw createError(400, 'USER_BANNED', 'Banned accounts cannot be reactivated via normal workflow.');
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      status: 'ACTIVE',
      statusChangedAt: new Date(),
      statusChangedByAdminId: adminAccountId,
      statusReason: reason || 'Reactivated by administrator',
    },
  });

  await logAdminAction({
    adminAccountId,
    action: 'USER_REACTIVATE',
    entityType: 'User',
    entityId: userId,
    before: { status: user.status },
    after: { status: updated.status, reason },
    reason,
  });

  return updated;
}

export async function banUser(
  userId: string,
  adminAccountId: string,
  reason: string
) {
  if (!reason?.trim()) {
    throw createError(400, 'REASON_REQUIRED', 'A reason is required to permanently ban a user.');
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw createError(404, 'USER_NOT_FOUND', 'User does not exist');
  if (user.status === 'BANNED') {
    throw createError(400, 'ALREADY_BANNED', 'User is already permanently banned.');
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      status: 'BANNED',
      statusChangedAt: new Date(),
      statusChangedByAdminId: adminAccountId,
      statusReason: reason.trim(),
      tokenVersion: { increment: 1 }, // Invalidate sessions immediately
    },
  });

  await logAdminAction({
    adminAccountId,
    action: 'USER_BAN',
    entityType: 'User',
    entityId: userId,
    before: { status: user.status },
    after: { status: updated.status, reason },
    reason,
  });

  return updated;
}

export async function grantEntitlementOverride(params: {
  userId: string;
  planId: string;
  durationDays?: number;
  reason: string;
  adminAccountId: string;
}) {
  const plan = await prisma.plan.findUnique({ where: { id: params.planId } });
  if (!plan) throw createError(404, 'PLAN_NOT_FOUND', 'Target plan does not exist');

  const user = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!user) throw createError(404, 'USER_NOT_FOUND', 'User does not exist');

  const startsAt = new Date();
  const endsAt = params.durationDays
    ? new Date(Date.now() + params.durationDays * 24 * 60 * 60 * 1000)
    : null;

  const override = await prisma.entitlementOverride.create({
    data: {
      userId: params.userId,
      planId: params.planId,
      reason: params.reason,
      startsAt,
      endsAt,
      createdByAdminId: params.adminAccountId,
    },
    include: { plan: true },
  });

  await logAdminAction({
    adminAccountId: params.adminAccountId,
    action: 'ENTITLEMENT_OVERRIDE_GRANTED',
    entityType: 'EntitlementOverride',
    entityId: override.id,
    after: override,
    reason: params.reason,
  });

  return override;
}

export async function revokeEntitlementOverride(
  overrideId: string,
  adminAccountId: string,
  reason?: string
) {
  const existing = await prisma.entitlementOverride.findUnique({ where: { id: overrideId } });
  if (!existing || existing.revokedAt) {
    throw createError(404, 'OVERRIDE_NOT_FOUND', 'Override not found or already revoked');
  }

  const updated = await prisma.entitlementOverride.update({
    where: { id: overrideId },
    data: { revokedAt: new Date() },
  });

  await logAdminAction({
    adminAccountId,
    action: 'ENTITLEMENT_OVERRIDE_REVOKED',
    entityType: 'EntitlementOverride',
    entityId: overrideId,
    before: existing,
    after: updated,
    reason,
  });

  return updated;
}