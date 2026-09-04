// backend/tests/unit/paymentMethodUpdate.test.ts
import { describe, it, expect, vi, beforeAll } from 'vitest';
import crypto from 'crypto';
import { env } from '../../src/config/env';
import { prisma } from '../../src/lib/prismaClient';
import * as razorpaySub from '../../src/providers/razorpay/razorpay.subscription';
import {
  setupPaymentMethodUpdateOrder,
  confirmPaymentMethodUpdate,
} from '../../src/services/billing.service';
import { cancelSubscriptionAction } from '../../src/services/subscription.service';

describe('Payment Method Update & Auto-Pay Toggle Flow', () => {
  let testUser: any;
  let testPlan: any;

  beforeAll(async () => {
    testUser = await prisma.user.findFirst();
    if (!testUser) {
      testUser = await prisma.user.create({
        data: {
          email: `pm_update_${Date.now()}@finamite.test`,
          passwordHash: 'hashed_password',
          name: 'PM Tester',
        },
      });
    }

    testPlan = await prisma.plan.findFirst({ where: { slug: 'premium' } });
    if (!testPlan) {
      testPlan = await prisma.plan.findFirst({ where: { isActive: true, priceCents: { gt: 0 } } });
    }
  });

  it('sets up a replacement Razorpay subscription mandate starting at currentPeriodEnd', async () => {
    const oldProviderSubId = `sub_old_pm_${Date.now()}`;
    const futurePeriodEnd = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);

    const sub = await prisma.subscription.create({
      data: {
        userId: testUser.id,
        planId: testPlan.id,
        provider: 'razorpay',
        providerSubscriptionId: oldProviderSubId,
        status: 'ACTIVE',
        billingInterval: testPlan.billingInterval,
        currentPeriodStart: new Date(),
        currentPeriodEnd: futurePeriodEnd,
        autoRenew: true,
      },
    });

    const createSpy = vi.spyOn(razorpaySub, 'createRazorpaySubscription').mockResolvedValue({
      id: 'sub_new_mandate_123',
      entity: 'subscription',
      plan_id: 'plan_provider_123',
      status: 'created',
      start_at: Math.floor(futurePeriodEnd.getTime() / 1000),
    } as any);

    const setupResult = await setupPaymentMethodUpdateOrder(testUser.id);

    expect(createSpy).toHaveBeenCalled();
    expect(setupResult.providerSubscriptionId).toBe('sub_new_mandate_123');
    expect(setupResult.scheduledStartAt).toBe(Math.floor(futurePeriodEnd.getTime() / 1000));

    createSpy.mockRestore();
    await prisma.subscription.delete({ where: { id: sub.id } });
  });

  it('confirms payment method update: cancels old subscription and links new mandate', async () => {
    const oldProviderSubId = `sub_to_cancel_${Date.now()}`;
    const newProviderSubId = `sub_new_active_${Date.now()}`;
    const paymentId = `pay_auth_${Date.now()}`;
    const futurePeriodEnd = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);

    const sub = await prisma.subscription.create({
      data: {
        userId: testUser.id,
        planId: testPlan.id,
        provider: 'razorpay',
        providerSubscriptionId: oldProviderSubId,
        status: 'ACTIVE',
        billingInterval: testPlan.billingInterval,
        currentPeriodStart: new Date(),
        currentPeriodEnd: futurePeriodEnd,
        autoRenew: false,
        cancelAtPeriodEnd: true,
      },
    });

    const cancelSpy = vi.spyOn(razorpaySub, 'cancelRazorpaySubscription').mockResolvedValue({
      id: oldProviderSubId,
      status: 'cancelled',
    } as any);

    const secret = env.RAZORPAY_KEY_SECRET || 'rzp_sec_test_secret';
    const validSignature = crypto
      .createHmac('sha256', secret)
      .update(`${paymentId}|${newProviderSubId}`)
      .digest('hex');

    const result = await confirmPaymentMethodUpdate({
      userId: testUser.id,
      newProviderSubscriptionId: newProviderSubId,
      paymentId,
      signature: validSignature,
    });

    expect(result.success).toBe(true);
    expect(cancelSpy).toHaveBeenCalledWith(oldProviderSubId, false);

    const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(updatedSub?.providerSubscriptionId).toBe(newProviderSubId);
    expect(updatedSub?.autoRenew).toBe(true);
    expect(updatedSub?.cancelAtPeriodEnd).toBe(false);

    cancelSpy.mockRestore();
    await prisma.subscription.delete({ where: { id: sub.id } });
  });

  it('toggles Auto-Pay OFF: marks cancelAtPeriodEnd=true without immediate termination', async () => {
    const oldProviderSubId = `sub_autopay_off_${Date.now()}`;
    const futurePeriodEnd = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

    const sub = await prisma.subscription.create({
      data: {
        userId: testUser.id,
        planId: testPlan.id,
        provider: 'razorpay',
        providerSubscriptionId: oldProviderSubId,
        status: 'ACTIVE',
        billingInterval: testPlan.billingInterval,
        currentPeriodStart: new Date(),
        currentPeriodEnd: futurePeriodEnd,
        autoRenew: true,
        cancelAtPeriodEnd: false,
      },
    });

    const cancelSpy = vi.spyOn(razorpaySub, 'cancelRazorpaySubscription').mockResolvedValue({
      id: oldProviderSubId,
      status: 'active',
    } as any);

    const cancelled = await cancelSubscriptionAction(sub.id, true);

    expect(cancelSpy).toHaveBeenCalledWith(oldProviderSubId, true);
    expect(cancelled.status).toBe('ACTIVE');
    expect(cancelled.autoRenew).toBe(false);
    expect(cancelled.cancelAtPeriodEnd).toBe(true);

    cancelSpy.mockRestore();
    await prisma.subscription.delete({ where: { id: sub.id } });
  });

  it('reconciles payment method update via webhook subscription.authenticated: cancels old mandate and links new mandate authoritatively', async () => {
    const oldProviderSubId = `sub_wh_old_${Date.now()}`;
    const newProviderSubId = `sub_wh_new_${Date.now()}`;
    const paymentId = `pay_wh_${Date.now()}`;
    const futurePeriodEnd = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);

    const sub = await prisma.subscription.create({
      data: {
        userId: testUser.id,
        planId: testPlan.id,
        provider: 'razorpay',
        providerSubscriptionId: oldProviderSubId,
        status: 'ACTIVE',
        billingInterval: testPlan.billingInterval,
        currentPeriodStart: new Date(),
        currentPeriodEnd: futurePeriodEnd,
        autoRenew: false,
        cancelAtPeriodEnd: true,
      },
    });

    const cancelSpy = vi.spyOn(razorpaySub, 'cancelRazorpaySubscription').mockResolvedValue({
      id: oldProviderSubId,
      status: 'cancelled',
    } as any);

    // Call applyPaymentMethodUpdate simulating the incoming webhook
    const { applyPaymentMethodUpdate } = await import('../../src/services/billing.service');
    const result = await applyPaymentMethodUpdate({
      newProviderSubscriptionId: newProviderSubId,
      paymentId,
      paymentEntity: {
        id: paymentId,
        method: 'upi',
        vpa: 'user@okaxis',
        amount: 0,
      },
      userId: testUser.id,
      subscriptionId: sub.id,
      source: 'WEBHOOK',
    });

    expect(result.success).toBe(true);
    expect(cancelSpy).toHaveBeenCalledWith(oldProviderSubId, false);

    const updatedSub = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(updatedSub?.providerSubscriptionId).toBe(newProviderSubId);
    expect(updatedSub?.autoRenew).toBe(true);
    expect(updatedSub?.cancelAtPeriodEnd).toBe(false);

    // Check that transaction metadata was recorded with new UPI VPA
    const tx = await prisma.billingTransaction.findFirst({
      where: { providerPaymentId: paymentId },
    });
    expect(tx).not.toBeNull();
    expect((tx?.metadata as any)?.vpa).toBe('user@okaxis');
    expect((tx?.metadata as any)?.paymentMethod).toBe('upi');

    cancelSpy.mockRestore();
    await prisma.billingTransaction.deleteMany({ where: { providerPaymentId: paymentId } });
    await prisma.subscription.delete({ where: { id: sub.id } });
  });
});
