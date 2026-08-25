// backend/src/services/reconciliation.service.ts
// Reconciles database billing state with Razorpay provider state.

import { prisma } from '../lib/prismaClient';
import { logAdminAction } from './audit.service';
import { fetchRazorpayPayment } from '../providers/razorpay/razorpay.payment';
import { fetchRazorpaySubscription } from '../providers/razorpay/razorpay.subscription';

export async function runBillingReconciliation(adminAccountId?: string) {
  const discrepancies: Array<{
    type: 'TRANSACTION' | 'SUBSCRIPTION';
    id: string;
    providerId: string;
    localStatus: string;
    providerStatus: string;
    resolution?: string;
  }> = [];

  // 1. Check pending payment orders older than 1 hour
  const pendingOrders = await prisma.paymentOrder.findMany({
    where: {
      status: 'CREATED',
      createdAt: { lte: new Date(Date.now() - 60 * 60 * 1000) },
    },
    take: 20,
  });

  for (const order of pendingOrders) {
    try {
      if (order.providerOrderId) {
        // Find if any transactions were captured
        const tx = await prisma.billingTransaction.findFirst({
          where: { providerOrderId: order.providerOrderId },
        });
        if (tx && tx.status === 'CAPTURED') {
          await prisma.paymentOrder.update({
            where: { id: order.id },
            data: { status: 'CAPTURED' },
          });
          discrepancies.push({
            type: 'TRANSACTION',
            id: order.id,
            providerId: order.providerOrderId,
            localStatus: 'CREATED',
            providerStatus: 'CAPTURED',
            resolution: 'Updated local order to CAPTURED based on transaction record',
          });
        }
      }
    } catch (e) {
      console.warn('[Reconciliation] Error checking order:', e);
    }
  }

  // 2. Check active subscriptions against provider
  const activeSubs = await prisma.subscription.findMany({
    where: { status: 'ACTIVE' },
    take: 20,
  });

  for (const sub of activeSubs) {
    try {
      const rzpSub = await fetchRazorpaySubscription(sub.providerSubscriptionId);
      if (rzpSub && rzpSub.status === 'cancelled' && sub.status === 'ACTIVE') {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: 'CANCELLED', endedAt: new Date() },
        });
        discrepancies.push({
          type: 'SUBSCRIPTION',
          id: sub.id,
          providerId: sub.providerSubscriptionId,
          localStatus: 'ACTIVE',
          providerStatus: 'cancelled',
          resolution: 'Synchronized local subscription to CANCELLED',
        });
      }
    } catch (e) {
      console.warn('[Reconciliation] Error fetching provider subscription:', e);
    }
  }

  if (adminAccountId && discrepancies.length > 0) {
    await logAdminAction({
      adminAccountId,
      action: 'RECONCILIATION_PERFORMED',
      entityType: 'System',
      after: discrepancies,
      reason: `Reconciled ${discrepancies.length} discrepancy items`,
    });
  }

  return {
    checkedAt: new Date(),
    discrepanciesFound: discrepancies.length,
    items: discrepancies,
  };
}