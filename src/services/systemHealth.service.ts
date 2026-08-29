// backend/src/services/systemHealth.service.ts
// Operational health check, failed webhook tracker, and subsystem diagnostics.

import { prisma } from '../lib/prismaClient';
import { env } from '../config/env';
import fs from 'fs';
import path from 'path';

export async function getSystemHealthOverview() {
  const startTime = Date.now();
  let dbStatus = 'healthy';
  let dbLatencyMs = 0;

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - startTime;
  } catch (err) {
    dbStatus = 'degraded';
  }

  // Count unhandled webhooks
  const [
    unprocessedWebhooks,
    failedWebhooks,
    failedPayments,
    totalUsers,
    activeSubscriptions,
    totalPlans,
    totalTransactions,
    pendingRefunds,
    totalLedgerEvents,
  ] = await Promise.all([
    prisma.paymentWebhookEvent.count({ where: { processingStatus: 'RECEIVED' } }),
    prisma.paymentWebhookEvent.count({ where: { processingStatus: 'FAILED' } }),
    prisma.billingTransaction.count({ where: { status: 'FAILED' } }),
    prisma.user.count(),
    prisma.subscription.count({ where: { status: { in: ['ACTIVE', 'PAST_DUE'] } } }),
    prisma.plan.count({ where: { isActive: true } }),
    prisma.billingTransaction.count(),
    prisma.refund.count({ where: { status: 'PENDING' } }),
    prisma.paymentWebhookEvent.count(),
  ]);

  const recentFailedWebhooks = await prisma.paymentWebhookEvent.findMany({
    where: { processingStatus: 'FAILED' },
    take: 10,
    orderBy: { receivedAt: 'desc' },
    select: {
      id: true,
      eventType: true,
      processingStatus: true,
      receivedAt: true,
      lastError: true,
    },
  });

  // File storage: verify the uploads directory exists and is writable.
  let storageStatus = 'healthy';
  let storageDescription = 'Local disk storage';
  try {
    const root = path.resolve(process.cwd(), 'uploads');
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
    fs.accessSync(root, fs.constants.W_OK);
    storageDescription = root;
  } catch (err) {
    storageStatus = 'degraded';
    storageDescription = 'Uploads directory is not writable';
  }

  const schedulerRunning = Boolean((globalThis as any).__schedulerRunning);
  const subscriptionSchedulerRunning = Boolean((globalThis as any).__schedulerSubscriptionRunning);
  const billingLifecycleSchedulerRunning = Boolean((globalThis as any).__schedulerBillingLifecycleRunning);
  const pushConfigured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

  return {
    generatedAt: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    nodeVersion: process.version,
    subsystems: {
      database: {
        status: dbStatus,
        latencyMs: dbLatencyMs,
        engine: 'PostgreSQL',
      },
      smtp: {
        status: env.SMTP_HOST || env.SMTP_USER ? 'healthy' : 'degraded',
        configured: Boolean(env.SMTP_HOST || env.SMTP_USER),
        host: env.SMTP_HOST || 'Not configured',
      },
      paymentProvider: {
        provider: 'Razorpay',
        status: env.RAZORPAY_KEY_ID && !env.RAZORPAY_KEY_ID.includes('dummy') ? 'healthy' : 'degraded',
        mode: env.RAZORPAY_MODE,
        configured: Boolean(env.RAZORPAY_KEY_ID && !env.RAZORPAY_KEY_ID.includes('dummy')),
      },
      aiProvider: {
        provider: env.AI_PROVIDER || 'Disabled',
        status: env.OPENAI_API_KEY && env.AI_PROVIDER ? 'healthy' : 'degraded',
        model: env.AI_MODEL || 'Default',
        configured: Boolean(env.OPENAI_API_KEY && env.AI_PROVIDER),
      },
      scheduler: {
        status: schedulerRunning ? 'healthy' : 'degraded',
        running: schedulerRunning,
        label: 'Reminder scheduler',
      },
      subscriptionScheduler: {
        status: subscriptionSchedulerRunning ? 'healthy' : 'degraded',
        running: subscriptionSchedulerRunning,
        label: 'Subscription renewal scheduler',
      },
      billingLifecycleScheduler: {
        status: billingLifecycleSchedulerRunning ? 'healthy' : 'degraded',
        running: billingLifecycleSchedulerRunning,
        label: 'Billing lifecycle scheduler',
      },
      pushNotifications: {
        status: pushConfigured ? 'healthy' : 'degraded',
        configured: pushConfigured,
        label: 'Web push notifications',
      },
      fileStorage: {
        status: storageStatus,
        root: storageDescription,
      },
    },
    metrics: {
      systemUptimeSeconds: Math.floor(process.uptime()),
      unprocessedWebhooks,
      failedWebhooks,
      failedPayments,
      totalUsers,
      activeSubscriptions,
      totalPlans,
      totalTransactions,
      pendingRefunds,
      totalLedgerEvents,
    },
    recentFailedWebhooks,
  };
}
