// backend/src/services/subscription.service.ts
// Manages recurring subscriptions, provider sync, and immutable SubscriptionEvents.

import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import {
  createRazorpaySubscription,
  cancelRazorpaySubscription,
  pauseRazorpaySubscription,
  resumeRazorpaySubscription,
  fetchRazorpaySubscription,
} from '../providers/razorpay/razorpay.subscription';
import { sendNotification } from './notification.service';
import type { SubscriptionStatus, SubscriptionEventType, Prisma } from '@prisma/client';

export async function listSubscriptions(params?: {
  page?: number;
  pageSize?: number;
  status?: SubscriptionStatus;
  search?: string;
}) {
  const page = Math.max(1, params?.page || 1);
  const pageSize = Math.min(100, Math.max(1, params?.pageSize || 20));
  const skip = (page - 1) * pageSize;

  const where: Prisma.SubscriptionWhereInput = {};
  if (params?.status) where.status = params.status;
  if (params?.search?.trim()) {
    const q = params.search.trim();
    where.OR = [
      { user: { email: { contains: q, mode: 'insensitive' } } },
      { user: { name: { contains: q, mode: 'insensitive' } } },
      { providerSubscriptionId: { contains: q } },
    ];
  }

  const [totalCount, items] = await Promise.all([
    prisma.subscription.count({ where }),
    prisma.subscription.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, email: true, name: true } },
        plan: true,
        events: { orderBy: { occurredAt: 'desc' }, take: 3 },
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

export async function getSubscriptionDetail(id: string) {
  const sub = await prisma.subscription.findUnique({
    where: { id },
    include: {
      user: true,
      plan: true,
      events: { orderBy: { occurredAt: 'desc' } },
      invoices: { orderBy: { issuedAt: 'desc' } },
      billingTransactions: { orderBy: { createdAt: 'desc' } },
    },
  });

  if (!sub) throw createError(404, 'SUBSCRIPTION_NOT_FOUND', 'Subscription not found');
  return sub;
}

export async function recordSubscriptionEvent(params: {
  subscriptionId: string;
  eventType: SubscriptionEventType;
  provider: string;
  providerEventId?: string;
  payload?: any;
  occurredAt?: Date;
}) {
  return prisma.subscriptionEvent.create({
    data: {
      subscriptionId: params.subscriptionId,
      eventType: params.eventType,
      provider: params.provider,
      providerEventId: params.providerEventId,
      payload: params.payload ?? undefined,
      occurredAt: params.occurredAt || new Date(),
    },
  });
}

export async function initiateSubscription(params: {
  userId: string;
  planId: string;
  provider?: string;
}) {
  const plan = await prisma.plan.findUnique({
    where: { id: params.planId },
    include: { paymentProviderPlans: { where: { isActive: true } } },
  });

  if (!plan || !plan.isActive) {
    throw createError(400, 'INVALID_PLAN', 'Selected plan is not available');
  }

  const provider = params.provider || 'razorpay';
  const providerPlan = plan.paymentProviderPlans.find((p) => p.provider === provider);

  if (!providerPlan) {
    throw createError(400, 'PROVIDER_PLAN_MISSING', 'Payment provider plan not configured');
  }

  const rzpSub = await createRazorpaySubscription({
    planId: providerPlan.providerPlanId,
    totalCount: 12,
    customerNotify: 1,
  });

  const now = new Date();
  const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const sub = await prisma.subscription.create({
    data: {
      userId: params.userId,
      planId: plan.id,
      provider,
      providerSubscriptionId: rzpSub.id,
      providerPlanId: providerPlan.providerPlanId,
      status: 'CREATED',
      billingInterval: plan.billingInterval,
      quantity: 1,
      currentPeriodStart: new Date(rzpSub.current_start ? rzpSub.current_start * 1000 : now.getTime()),
      currentPeriodEnd: new Date(rzpSub.current_end ? rzpSub.current_end * 1000 : periodEnd.getTime()),
      startedAt: now,
    },
    include: { plan: true },
  });

  await recordSubscriptionEvent({
    subscriptionId: sub.id,
    eventType: 'CREATED',
    provider,
    providerEventId: rzpSub.id,
    payload: rzpSub,
  });

  return sub;
}

export async function cancelSubscriptionAction(id: string, cancelAtPeriodEnd: boolean = true) {
  const sub = await prisma.subscription.findUnique({ where: { id }, include: { plan: true } });
  if (!sub) throw createError(404, 'SUBSCRIPTION_NOT_FOUND', 'Subscription not found');

  try {
    await cancelRazorpaySubscription(sub.providerSubscriptionId, cancelAtPeriodEnd);
  } catch (err) {
    console.warn('[SubscriptionService] Razorpay cancel call deferred:', err);
  }

  const updated = await prisma.subscription.update({
    where: { id },
    data: {
      status: cancelAtPeriodEnd ? sub.status : 'CANCELLED',
      cancelAtPeriodEnd,
      cancelledAt: new Date(),
      endedAt: cancelAtPeriodEnd ? undefined : new Date(),
    },
  });

  await recordSubscriptionEvent({
    subscriptionId: id,
    eventType: 'CANCELLED',
    provider: sub.provider,
    occurredAt: new Date(),
  });

  try {
    await sendNotification(
      sub.userId,
      `Subscription ${cancelAtPeriodEnd ? 'scheduled for cancellation' : 'cancelled'}`,
      cancelAtPeriodEnd
        ? `Your ${sub.plan.name} subscription will stay active until ${updated.currentPeriodEnd.toLocaleDateString('en-IN')}.`
        : `Your ${sub.plan.name} subscription has been cancelled and access ends immediately.`,
      ['EMAIL'],
      undefined,
      {
        emailSubject: cancelAtPeriodEnd
          ? `Your subscription is scheduled to end on ${updated.currentPeriodEnd.toLocaleDateString('en-IN')}`
          : 'Your subscription has been cancelled',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#ffffff;color:#111827">
            <h1 style="margin:0 0 12px;font-size:26px">Subscription update</h1>
            <p style="margin:0 0 16px;color:#4b5563">
              ${cancelAtPeriodEnd
                ? 'Your subscription is scheduled to cancel at the end of the current billing period.'
                : 'Your subscription was cancelled immediately.'}
            </p>
              <div style="padding:16px;border:1px solid #e5e7eb;border-radius:14px;background:#f9fafb">
              <p style="margin:0 0 8px"><strong>Plan:</strong> ${sub.plan.name}</p>
              <p style="margin:0 0 8px"><strong>Current period ends:</strong> ${updated.currentPeriodEnd.toLocaleDateString('en-IN')}</p>
              <p style="margin:0"><strong>Status:</strong> ${updated.status}</p>
            </div>
          </div>
        `,
      }
    );
  } catch (err) {
    console.warn('[SubscriptionService] Failed to send cancellation email:', err);
  }

  return updated;
}

export async function pauseSubscriptionAction(id: string) {
  const sub = await prisma.subscription.findUnique({ where: { id } });
  if (!sub) throw createError(404, 'SUBSCRIPTION_NOT_FOUND', 'Subscription not found');

  try {
    await pauseRazorpaySubscription(sub.providerSubscriptionId);
  } catch (err) {
    console.warn('[SubscriptionService] Razorpay pause call deferred:', err);
  }

  const updated = await prisma.subscription.update({
    where: { id },
    data: { status: 'PAUSED' },
  });

  await recordSubscriptionEvent({
    subscriptionId: id,
    eventType: 'PAUSED',
    provider: sub.provider,
    occurredAt: new Date(),
  });

  return updated;
}

export async function resumeSubscriptionAction(id: string) {
  const sub = await prisma.subscription.findUnique({ where: { id } });
  if (!sub) throw createError(404, 'SUBSCRIPTION_NOT_FOUND', 'Subscription not found');

  try {
    await resumeRazorpaySubscription(sub.providerSubscriptionId);
  } catch (err) {
    console.warn('[SubscriptionService] Razorpay resume call deferred:', err);
  }

  const updated = await prisma.subscription.update({
    where: { id },
    data: { status: 'ACTIVE' },
  });

  await recordSubscriptionEvent({
    subscriptionId: id,
    eventType: 'RESUMED',
    provider: sub.provider,
    occurredAt: new Date(),
  });

  return updated;
}
