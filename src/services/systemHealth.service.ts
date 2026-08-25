// backend/src/services/systemHealth.service.ts
// Operational health check, failed webhook tracker, and subsystem diagnostics.

import { prisma } from '../lib/prismaClient';
import { env } from '../config/env';

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
  const [unprocessedWebhooks, failedWebhooks, failedPayments] = await Promise.all([
    prisma.paymentWebhookEvent.count({ where: { processingStatus: 'RECEIVED' } }),
    prisma.paymentWebhookEvent.count({ where: { processingStatus: 'FAILED' } }),
    prisma.billingTransaction.count({ where: { status: 'FAILED' } }),
  ]);

  const recentFailedWebhooks = await prisma.paymentWebhookEvent.findMany({
    where: { processingStatus: 'FAILED' },
    take: 10,
    orderBy: { receivedAt: 'desc' },
  });

  return {
    subsystems: {
      database: {
        status: dbStatus,
        latencyMs: dbLatencyMs,
      },
      smtp: {
        configured: Boolean(env.SMTP_HOST || env.SMTP_USER),
        host: env.SMTP_HOST || 'Ethereal / Gmail',
      },
      paymentProvider: {
        provider: 'Razorpay',
        mode: env.RAZORPAY_MODE,
        configured: Boolean(env.RAZORPAY_KEY_ID && !env.RAZORPAY_KEY_ID.includes('dummy')),
      },
      aiProvider: {
        provider: env.AI_PROVIDER || 'Disabled',
        model: env.AI_MODEL || 'Default',
      },
    },
    metrics: {
      unprocessedWebhooks,
      failedWebhooks,
      failedPayments,
      systemUptimeSeconds: Math.floor(process.uptime()),
    },
    recentFailedWebhooks,
  };
}