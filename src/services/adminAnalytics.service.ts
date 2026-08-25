// backend/src/services/adminAnalytics.service.ts
// Aggregates business KPIs, MRR, ARR, revenue charts, user distribution, and churn.

import { prisma } from '../lib/prismaClient';

export async function getAdminOverviewMetrics(days: number = 30) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [
    totalUsers,
    activeUsers,
    deactivatedUsers,
    bannedUsers,
    newUsersInRange,
    activeSubs,
    allCapturedTx,
    allRefunds,
    plans,
    allUsers,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: 'ACTIVE' } }),
    prisma.user.count({ where: { status: 'DEACTIVATED' } }),
    prisma.user.count({ where: { status: 'BANNED' } }),
    prisma.user.count({ where: { createdAt: { gte: startDate } } }),
    prisma.subscription.findMany({
      where: { status: 'ACTIVE' },
      include: { plan: true },
    }),
    prisma.billingTransaction.findMany({
      where: { status: { in: ['CAPTURED', 'REFUNDED', 'PARTIALLY_REFUNDED'] } },
      select: { grossAmountCents: true, discountCents: true, netAmountCents: true, createdAt: true },
    }),
    prisma.refund.findMany({
      where: { status: 'PROCESSED' },
      select: { amountCents: true, createdAt: true },
    }),
    prisma.plan.findMany({
      include: {
        _count: {
          select: { subscriptions: { where: { status: 'ACTIVE' } } },
        },
      },
    }),
    prisma.user.findMany({
      select: { passwordHash: true, googleId: true },
    }),
  ]);

  // MRR Calculation: Normalize each active recurring subscription to monthly cents
  let mrrCents = 0;
  for (const sub of activeSubs) {
    if (sub.billingInterval === 'MONTH') {
      mrrCents += sub.plan.priceCents * sub.quantity;
    } else if (sub.billingInterval === 'YEAR') {
      mrrCents += Math.round((sub.plan.priceCents * sub.quantity) / 12);
    }
  }
  const arrCents = mrrCents * 12;

  // Revenue sums
  const grossRevenueCents = allCapturedTx.reduce((acc, t) => acc + t.grossAmountCents, 0);
  const totalDiscountsCents = allCapturedTx.reduce((acc, t) => acc + t.discountCents, 0);
  const totalRefundsCents = allRefunds.reduce((acc, r) => acc + r.amountCents, 0);
  const netRevenueCents = Math.max(0, grossRevenueCents - totalRefundsCents);

  // Time-series revenue and user buckets (grouped by day)
  const timeSeriesMap = new Map<string, { date: string; revenueCents: number; users: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().split('T')[0];
    timeSeriesMap.set(dateStr, { date: dateStr, revenueCents: 0, users: 0 });
  }

  for (const tx of allCapturedTx) {
    const d = tx.createdAt.toISOString().split('T')[0];
    if (timeSeriesMap.has(d)) {
      timeSeriesMap.get(d)!.revenueCents += tx.netAmountCents;
    }
  }

  const rangeUsers = await prisma.user.findMany({
    where: { createdAt: { gte: startDate } },
    select: { createdAt: true },
  });

  for (const u of rangeUsers) {
    const d = u.createdAt.toISOString().split('T')[0];
    if (timeSeriesMap.has(d)) {
      timeSeriesMap.get(d)!.users += 1;
    }
  }

  // Plan distribution
  const planDistribution = plans.map((p) => ({
    name: p.name,
    slug: p.slug,
    count: p._count.subscriptions,
  }));

  // Login method distribution
  let googleOnly = 0;
  let localOnly = 0;
  let bothMethods = 0;
  for (const u of allUsers) {
    if (u.googleId && u.passwordHash) bothMethods++;
    else if (u.googleId) googleOnly++;
    else localOnly++;
  }

  // Churn calculation
  const totalSubEver = await prisma.subscription.count();
  const cancelledSubs = await prisma.subscription.count({ where: { status: 'CANCELLED' } });
  const churnRate = totalSubEver > 0 ? (cancelledSubs / totalSubEver) * 100 : 0;

  return {
    kpis: {
      totalUsers,
      activeUsers,
      deactivatedUsers,
      bannedUsers,
      newUsersInRange,
      activeSubscriptions: activeSubs.length,
      mrrCents,
      arrCents,
      grossRevenueCents,
      totalDiscountsCents,
      totalRefundsCents,
      netRevenueCents,
      churnRate: parseFloat(churnRate.toFixed(2)),
    },
    charts: {
      timeSeries: Array.from(timeSeriesMap.values()),
      planDistribution,
      authMethodDistribution: [
        { method: 'Google OAuth', count: googleOnly },
        { method: 'Email/Password', count: localOnly },
        { method: 'Both Linked', count: bothMethods },
      ],
    },
  };
}

export async function getRevenueAnalytics(days: number = 30) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const transactions = await prisma.billingTransaction.findMany({
    where: { createdAt: { gte: startDate }, status: { in: ['CAPTURED', 'REFUNDED', 'PARTIALLY_REFUNDED'] } },
    orderBy: { createdAt: 'asc' },
    include: { plan: true },
  });

  return transactions;
}