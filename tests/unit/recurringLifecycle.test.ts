// backend/tests/unit/recurringLifecycle.test.ts
// Unit and lifecycle tests for recurring subscription upgrades, downgrades, and webhook reconciliations.

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { env } from '../../src/config/env';
import { prisma } from '../../src/lib/prismaClient';
import * as razorpaySub from '../../src/providers/razorpay/razorpay.subscription';
import {
  recordSuccessfulPayment,
  scheduleDowngradeSubscription,
  cancelScheduledDowngrade,
  processRazorpayWebhook,
} from '../../src/services/billing.service';

function callWebhook(event: any) {
  const rawBody = JSON.stringify(event);
  const secret = env.RAZORPAY_WEBHOOK_SECRET || 'rzp_whsec_test_local_secret_secure';
  const signature = crypto.createHmac('sha256', secret).update(Buffer.from(rawBody, 'utf8')).digest('hex');
  return processRazorpayWebhook(rawBody, signature);
}

describe('Recurring Subscription Lifecycle & Edge Cases', () => {
  let testUser: any;
  let basePlan: any;
  let upgradePlan: any;
  let lowerPlan: any;
  const createdPlanIds: string[] = [];

  beforeAll(async () => {
    testUser = await prisma.user.findFirst();
    if (!testUser) {
      testUser = await prisma.user.create({
        data: {
          email: `lifecycle_${Date.now()}@finamite.test`,
          passwordHash: 'hashed_password',
          name: 'Lifecycle Tester',
        },
      });
    }

    basePlan = await prisma.plan.findFirst({ where: { slug: 'basic' } });
    if (!basePlan) {
      basePlan = await prisma.plan.create({
        data: {
          name: 'Pro Plan',
          slug: 'test_lifecycle_basic',
          priceCents: 99900,
          currency: 'INR',
          billingInterval: 'MONTH',
          isActive: true,
          features: [],
        },
      });
      createdPlanIds.push(basePlan.id);
    }

    upgradePlan = await prisma.plan.findFirst({ where: { slug: 'ultimate' } });
    if (!upgradePlan) {
      upgradePlan = await prisma.plan.create({
        data: {
          name: 'Ultimate Plan',
          slug: 'test_lifecycle_ultimate',
          priceCents: 199900,
          currency: 'INR',
          billingInterval: 'MONTH',
          isActive: true,
          features: [],
        },
      });
      createdPlanIds.push(upgradePlan.id);
    }

    lowerPlan = await prisma.plan.findFirst({ where: { slug: 'test_lifecycle_starter' } });
    if (!lowerPlan) {
      lowerPlan = await prisma.plan.create({
        data: {
          name: 'Starter Plan',
          slug: 'test_lifecycle_starter',
          priceCents: 49900,
          currency: 'INR',
          billingInterval: 'MONTH',
          isActive: true,
          features: [],
        },
      });
      createdPlanIds.push(lowerPlan.id);
    }
  });

  afterAll(async () => {
    for (const planId of createdPlanIds) {
      await prisma.paymentProviderPlan.deleteMany({ where: { planId } }).catch(() => null);
      await prisma.couponPlan.deleteMany({ where: { planId } }).catch(() => null);
      await prisma.subscription.deleteMany({ where: { planId } }).catch(() => null);
      await prisma.plan.delete({ where: { id: planId } }).catch(() => null);
    }
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('Mid-cycle upgrade: cancels old Razorpay subscription only AFTER new payment succeeds', async () => {
    const oldSubId = `sub_old_${Date.now()}`;
    const newSubId = `sub_new_${Date.now()}`;
    const newPayId = `pay_new_${Date.now()}`;

    // 1. Setup user on existing active base plan (₹999/mo)
    const activeSub = await prisma.subscription.create({
      data: {
        userId: testUser.id,
        planId: basePlan.id,
        provider: 'razorpay',
        providerSubscriptionId: oldSubId,
        status: 'ACTIVE',
        billingInterval: 'MONTH',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 15 * 86400 * 1000),
        autoRenew: true,
      },
    });

    // Mock Razorpay cancellation
    const cancelSpy = vi.spyOn(razorpaySub, 'cancelRazorpaySubscription').mockResolvedValue({
      id: oldSubId,
      entity: 'subscription',
      status: 'cancelled',
    } as any);

    // 2. User completes upgrade checkout payment
    await recordSuccessfulPayment({
      userId: testUser.id,
      provider: 'razorpay',
      providerPaymentId: newPayId,
      providerSubscriptionId: newSubId,
      planId: upgradePlan.id,
      amountCents: 117882, // prorated upgrade amount
      currency: 'INR',
      autoRenew: true,
      metadata: {
        isUpgrade: true,
      },
    });

    // 3. Verify old Razorpay subscription was cancelled immediately with cancel_at_cycle_end: false
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(cancelSpy).toHaveBeenCalledWith(oldSubId, false);

    // 4. Verify DB was updated to the new plan and new provider subscription ID
    const updatedSub = await prisma.subscription.findUnique({
      where: { id: activeSub.id },
    });
    expect(updatedSub?.planId).toBe(upgradePlan.id);
    expect(updatedSub?.providerSubscriptionId).toBe(newSubId);
    expect(updatedSub?.status).toBe('ACTIVE');

    // Clean up
    await prisma.subscription.delete({ where: { id: activeSub.id } }).catch(() => null);
  });

  it('Failed old-subscription cancellation records REQUIRES_RECONCILIATION without breaking upgrade', async () => {
    const oldSubId = `sub_old_fail_${Date.now()}`;
    const newSubId = `sub_new_succ_${Date.now()}`;
    const newPayId = `pay_new_succ_${Date.now()}`;

    const activeSub = await prisma.subscription.create({
      data: {
        userId: testUser.id,
        planId: basePlan.id,
        provider: 'razorpay',
        providerSubscriptionId: oldSubId,
        status: 'ACTIVE',
        billingInterval: 'MONTH',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 15 * 86400 * 1000),
        autoRenew: true,
      },
    });

    // Mock cancellation throwing a network/gateway error
    vi.spyOn(razorpaySub, 'cancelRazorpaySubscription').mockRejectedValue(
      new Error('Gateway timeout on cancellation')
    );

    // Record successful upgrade payment
    const result = await recordSuccessfulPayment({
      userId: testUser.id,
      provider: 'razorpay',
      providerPaymentId: newPayId,
      providerSubscriptionId: newSubId,
      planId: upgradePlan.id,
      amountCents: 117882,
      currency: 'INR',
      autoRenew: true,
      metadata: {
        isUpgrade: true,
      },
    });

    expect(result).toBeDefined();
    expect(result.status).toBe('CAPTURED');

    // Verify a REQUIRES_RECONCILIATION subscription event was persisted
    const reconciliationEvent = await prisma.subscriptionEvent.findFirst({
      where: {
        subscriptionId: activeSub.id,
        eventType: 'REQUIRES_RECONCILIATION',
      },
      orderBy: { occurredAt: 'desc' },
    });

    expect(reconciliationEvent).toBeDefined();
    expect((reconciliationEvent?.payload as any)?.action).toBe('OLD_SUBSCRIPTION_CANCEL_FAILED');
    expect((reconciliationEvent?.payload as any)?.oldProviderSubscriptionId).toBe(oldSubId);

    // Clean up
    await prisma.subscription.delete({ where: { id: activeSub.id } }).catch(() => null);
  });

  it('Paid → Paid Downgrade: calls updateRazorpaySubscription with schedule_change_at: cycle_end', async () => {
    const activeSubId = `sub_downgrade_${Date.now()}`;

    const activeSub = await prisma.subscription.create({
      data: {
        userId: testUser.id,
        planId: upgradePlan.id, // ₹1,999/mo
        provider: 'razorpay',
        providerSubscriptionId: activeSubId,
        status: 'ACTIVE',
        billingInterval: 'MONTH',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 20 * 86400 * 1000),
        autoRenew: true,
      },
    });

    const updateSpy = vi.spyOn(razorpaySub, 'updateRazorpaySubscription').mockResolvedValue({
      id: activeSubId,
      entity: 'subscription',
      status: 'active',
    } as any);

    // Schedule downgrade to lowerPlan (₹499/mo)
    const downgradeRes = await scheduleDowngradeSubscription({
      userId: testUser.id,
      targetPlanId: lowerPlan.id,
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(
      activeSubId,
      expect.objectContaining({
        scheduleChangeAt: 'cycle_end',
        customerNotify: 1,
      })
    );

    expect(downgradeRes.scheduledDowngradePlan.id).toBe(lowerPlan.id);

    // Verify DB recorded scheduledPlanId and scheduledChangeAt without breaking active plan
    const updatedSub = await prisma.subscription.findUnique({
      where: { id: activeSub.id },
    });
    expect(updatedSub?.planId).toBe(upgradePlan.id); // Still on upgrade plan
    expect(updatedSub?.scheduledPlanId).toBe(lowerPlan.id);
    expect(updatedSub?.scheduledChangeAt).toBeDefined();
    expect(updatedSub?.cancelAtPeriodEnd).toBe(false);

    // Test cancelling the scheduled downgrade reverts the plan
    const revertRes = await cancelScheduledDowngrade({ userId: testUser.id });
    expect(revertRes.subscription.scheduledPlanId).toBeNull();
    expect(revertRes.subscription.scheduledChangeAt).toBeNull();

    // Clean up
    await prisma.subscription.delete({ where: { id: activeSub.id } }).catch(() => null);
  });

  it('Paid → Free Downgrade: calls cancelRazorpaySubscription with cancel_at_cycle_end: true', async () => {
    const activeSubId = `sub_to_free_${Date.now()}`;

    // Free plan (₹0)
    let freePlan = await prisma.plan.findFirst({ where: { priceCents: 0 } });
    if (!freePlan) {
      freePlan = await prisma.plan.create({
        data: {
          name: 'Free Tier',
          slug: `free_${Date.now()}`,
          priceCents: 0,
          currency: 'INR',
          billingInterval: 'MONTH',
          isActive: true,
          features: [],
        },
      });
    }

    const activeSub = await prisma.subscription.create({
      data: {
        userId: testUser.id,
        planId: basePlan.id,
        provider: 'razorpay',
        providerSubscriptionId: activeSubId,
        status: 'ACTIVE',
        billingInterval: 'MONTH',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 10 * 86400 * 1000),
        autoRenew: true,
      },
    });

    const cancelSpy = vi.spyOn(razorpaySub, 'cancelRazorpaySubscription').mockResolvedValue({
      id: activeSubId,
      entity: 'subscription',
      status: 'cancelled',
    } as any);

    await scheduleDowngradeSubscription({
      userId: testUser.id,
      targetPlanId: freePlan.id,
    });

    // Verify cancel_at_cycle_end was passed as true (1)
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(cancelSpy).toHaveBeenCalledWith(activeSubId, true);

    const updatedSub = await prisma.subscription.findUnique({
      where: { id: activeSub.id },
    });
    expect(updatedSub?.cancelAtPeriodEnd).toBe(true);
    expect(updatedSub?.scheduledPlanId).toBe(freePlan.id);

    // Clean up
    await prisma.subscription.delete({ where: { id: activeSub.id } }).catch(() => null);
  });

  it('Webhook reconciliation: subscription.charged at renewal applies scheduled downgrade', async () => {
    const subId = `sub_renew_${Date.now()}`;
    const paymentId = `pay_renew_${Date.now()}`;

    const activeSub = await prisma.subscription.create({
      data: {
        userId: testUser.id,
        planId: upgradePlan.id,
        provider: 'razorpay',
        providerSubscriptionId: subId,
        scheduledPlanId: lowerPlan.id,
        scheduledChangeAt: new Date(),
        status: 'ACTIVE',
        billingInterval: 'MONTH',
        currentPeriodStart: new Date(Date.now() - 30 * 86400 * 1000),
        currentPeriodEnd: new Date(),
        autoRenew: true,
      },
    });

    const webhookEvent = {
      id: `evt_renew_${Date.now()}`,
      event: 'subscription.charged',
      payload: {
        subscription: {
          entity: {
            id: subId,
            status: 'active',
            current_start: Math.floor(Date.now() / 1000),
            current_end: Math.floor((Date.now() + 30 * 86400 * 1000) / 1000),
          },
        },
        payment: {
          entity: {
            id: paymentId,
            amount: 58882, // ₹499 + 18% GST
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    };

    await callWebhook(webhookEvent);

    // Verify DB updated planId to lowerPlan, cleared scheduledPlanId, and created invoice
    const renewedSub = await prisma.subscription.findUnique({
      where: { id: activeSub.id },
    });
    expect(renewedSub?.planId).toBe(lowerPlan.id);
    expect(renewedSub?.scheduledPlanId).toBeNull();
    expect(renewedSub?.scheduledChangeAt).toBeNull();

    // Clean up
    await prisma.subscription.delete({ where: { id: activeSub.id } }).catch(() => null);
  });

  it('Webhook-before-client-verification idempotency test', async () => {
    const subId = `sub_wh_first_${Date.now()}`;
    const paymentId = `pay_wh_first_${Date.now()}`;

    // 1. Create order
    const order = await prisma.paymentOrder.create({
      data: {
        userId: testUser.id,
        planId: basePlan.id,
        type: 'SUBSCRIPTION_INITIAL',
        provider: 'razorpay',
        providerOrderId: subId,
        currency: 'INR',
        subtotalCents: 99900,
        taxCents: 17982,
        totalCents: 117882,
        status: 'CREATED',
      },
    });

    // 2. Webhook arrives FIRST (payment.captured)
    const webhookEvent = {
      id: `evt_wh_first_${Date.now()}`,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: null,
            subscription_id: subId,
            amount: 117882,
            currency: 'INR',
            status: 'captured',
            notes: {
              userId: testUser.id,
              planId: basePlan.id,
            },
          },
        },
      },
    };

    await callWebhook(webhookEvent);

    // Order should now be CAPTURED
    const orderAfterWebhook = await prisma.paymentOrder.findUnique({ where: { id: order.id } });
    expect(orderAfterWebhook?.status).toBe('CAPTURED');

    // 3. Client verification arrives SECOND
    const secondCall = await recordSuccessfulPayment({
      userId: testUser.id,
      provider: 'razorpay',
      providerPaymentId: paymentId,
      providerSubscriptionId: subId,
      amountCents: 117882,
      currency: 'INR',
      planId: basePlan.id,
      orderId: order.id,
    });

    // Idempotency: should return the existing transaction without creating duplicates
    expect(secondCall.status).toBe('CAPTURED');

    const txCount = await prisma.billingTransaction.count({
      where: { providerPaymentId: paymentId },
    });
    expect(txCount).toBe(1);

    // Clean up
    await prisma.subscription.deleteMany({ where: { providerSubscriptionId: subId } });
    await prisma.paymentOrder.delete({ where: { id: order.id } });
  });
});
