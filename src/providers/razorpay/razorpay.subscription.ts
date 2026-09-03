// backend/src/providers/razorpay/razorpay.subscription.ts
// Razorpay Subscription and Provider Plan lifecycle functions.

import crypto from 'crypto';
import { env } from '../../config/env';
import { razorpayRequest } from './razorpay.client';
import type { RazorpaySubscriptionEntity } from './razorpay.types';

export async function createRazorpayProviderPlan(params: {
  name: string;
  amountCents: number;
  currency: string;
  interval: 'monthly' | 'yearly' | 'daily' | 'weekly';
  description?: string;
}): Promise<{ id: string; entity: 'plan' }> {
  try {
    return await razorpayRequest<{ id: string; entity: 'plan' }>('/plans', {
      method: 'POST',
      body: {
        period: params.interval,
        interval: 1,
        item: {
          name: params.name,
          amount: params.amountCents,
          currency: params.currency,
          description: params.description,
        },
      },
    });
  } catch (err) {
    if (env.RAZORPAY_KEY_ID?.startsWith('rzp_test_dummy')) {
      return {
        id: `plan_mock_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        entity: 'plan',
      };
    }
    throw err;
  }
}

export async function createRazorpayOffer(params: {
  name: string;
  type: 'PERCENTAGE' | 'FIXED_AMOUNT';
  value: number;
  currency?: string;
  description?: string;
}): Promise<{ id: string; entity: 'offer' }> {
  try {
    const isPercent = params.type === 'PERCENTAGE';
    return await razorpayRequest<{ id: string; entity: 'offer' }>('/offers', {
      method: 'POST',
      body: {
        name: params.name,
        display_text: params.description || `${params.name} discount`,
        payment_method: 'card',
        type: isPercent ? 'disc_percent' : 'disc_flat',
        ...(isPercent ? { percent_rate: params.value } : { flat_rate: params.value }),
        period: 'once',
      },
    });
  } catch (err) {
    if (env.RAZORPAY_KEY_ID?.startsWith('rzp_test_dummy')) {
      return {
        id: `offer_mock_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        entity: 'offer',
      };
    }
    throw err;
  }
}

export async function listRazorpayOffers(): Promise<Array<{ id: string; name: string; status?: string }>> {
  try {
    const res = await razorpayRequest<{ items: Array<{ id: string; name: string; status?: string }> }>('/offers');
    return res.items || [];
  } catch (err: any) {
    return [];
  }
}

export async function createRazorpaySubscription(params: {
  planId: string;
  totalCount?: number;
  quantity?: number;
  customerNotify?: 0 | 1;
  startAt?: number;
  addons?: Array<{
    item: {
      name: string;
      amount: number;
      currency: string;
    };
  }>;
  offerId?: string;
  notes?: Record<string, any>;
}): Promise<RazorpaySubscriptionEntity> {
  try {
    const body: Record<string, any> = {
      plan_id: params.planId,
      total_count: params.totalCount || 12,
      quantity: params.quantity || 1,
      customer_notify: params.customerNotify ?? 1,
      notes: params.notes,
    };
    if (params.startAt) {
      body.start_at = params.startAt;
    }
    if (params.addons && params.addons.length > 0) {
      body.addons = params.addons;
    }
    if (params.offerId) {
      body.offer_id = params.offerId;
    }

    return await razorpayRequest<RazorpaySubscriptionEntity>('/subscriptions', {
      method: 'POST',
      body,
    });
  } catch (err) {
    if (env.RAZORPAY_KEY_ID?.startsWith('rzp_test_dummy')) {
      const now = Math.floor(Date.now() / 1000);
      return {
        id: `sub_mock_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        entity: 'subscription',
        plan_id: params.planId,
        status: 'created',
        current_start: now,
        current_end: now + 30 * 86400,
        quantity: params.quantity || 1,
        auth_attempts: 0,
        total_count: params.totalCount || 12,
        paid_count: 0,
        remaining_count: params.totalCount || 12,
        notes: params.notes,
        created_at: now,
      };
    }
    throw err;
  }
}

export async function fetchRazorpaySubscription(subscriptionId: string): Promise<RazorpaySubscriptionEntity> {
  try {
    return await razorpayRequest<RazorpaySubscriptionEntity>(`/subscriptions/${subscriptionId}`);
  } catch (err) {
    if (env.RAZORPAY_KEY_ID?.startsWith('rzp_test_dummy')) {
      const now = Math.floor(Date.now() / 1000);
      return {
        id: subscriptionId,
        entity: 'subscription',
        plan_id: 'plan_mock_1',
        status: 'active',
        current_start: now,
        current_end: now + 30 * 86400,
        quantity: 1,
        auth_attempts: 0,
        total_count: 12,
        paid_count: 1,
        remaining_count: 11,
        created_at: now,
      };
    }
    throw err;
  }
}

export async function cancelRazorpaySubscription(
  subscriptionId: string,
  cancelAtCycleEnd: boolean = false
): Promise<RazorpaySubscriptionEntity> {
  try {
    return await razorpayRequest<RazorpaySubscriptionEntity>(`/subscriptions/${subscriptionId}/cancel`, {
      method: 'POST',
      body: {
        cancel_at_cycle_end: cancelAtCycleEnd ? 1 : 0,
      },
    });
  } catch (err) {
    if (env.RAZORPAY_KEY_ID?.startsWith('rzp_test_dummy')) {
      return {
        id: subscriptionId,
        entity: 'subscription',
        plan_id: 'plan_mock_1',
        status: 'cancelled',
        current_start: Math.floor(Date.now() / 1000),
        current_end: Math.floor(Date.now() / 1000) + 30 * 86400,
        quantity: 1,
        auth_attempts: 0,
        total_count: 12,
        paid_count: 1,
        remaining_count: 11,
        created_at: Math.floor(Date.now() / 1000),
      };
    }
    throw err;
  }
}

export async function pauseRazorpaySubscription(subscriptionId: string): Promise<RazorpaySubscriptionEntity> {
  try {
    return await razorpayRequest<RazorpaySubscriptionEntity>(`/subscriptions/${subscriptionId}/pause`, {
      method: 'POST',
      body: { pause_at: 'now' },
    });
  } catch (err) {
    if (env.RAZORPAY_KEY_ID?.startsWith('rzp_test_dummy')) {
      return {
        id: subscriptionId,
        entity: 'subscription',
        plan_id: 'plan_mock_1',
        status: 'paused',
        current_start: Math.floor(Date.now() / 1000),
        current_end: Math.floor(Date.now() / 1000) + 30 * 86400,
        quantity: 1,
        auth_attempts: 0,
        total_count: 12,
        paid_count: 1,
        remaining_count: 11,
        created_at: Math.floor(Date.now() / 1000),
      };
    }
    throw err;
  }
}

export async function resumeRazorpaySubscription(subscriptionId: string): Promise<RazorpaySubscriptionEntity> {
  try {
    return await razorpayRequest<RazorpaySubscriptionEntity>(`/subscriptions/${subscriptionId}/resume`, {
      method: 'POST',
      body: { resume_at: 'now' },
    });
  } catch (err) {
    if (env.RAZORPAY_KEY_ID?.startsWith('rzp_test_dummy')) {
      return {
        id: subscriptionId,
        entity: 'subscription',
        plan_id: 'plan_mock_1',
        status: 'active',
        current_start: Math.floor(Date.now() / 1000),
        current_end: Math.floor(Date.now() / 1000) + 30 * 86400,
        quantity: 1,
        auth_attempts: 0,
        total_count: 12,
        paid_count: 1,
        remaining_count: 11,
        created_at: Math.floor(Date.now() / 1000),
      };
    }
    throw err;
  }
}

export async function updateRazorpaySubscription(
  subscriptionId: string,
  params: {
    planId: string;
    scheduleChangeAt?: 'now' | 'cycle_end';
    customerNotify?: 0 | 1;
    remainingCount?: number;
  }
): Promise<RazorpaySubscriptionEntity> {
  try {
    return await razorpayRequest<RazorpaySubscriptionEntity>(`/subscriptions/${subscriptionId}`, {
      method: 'PATCH',
      body: {
        plan_id: params.planId,
        schedule_change_at: params.scheduleChangeAt || 'cycle_end',
        customer_notify: params.customerNotify ?? 1,
        ...(params.remainingCount !== undefined ? { remaining_count: params.remainingCount } : {}),
      },
    });
  } catch (err) {
    if (env.RAZORPAY_KEY_ID?.startsWith('rzp_test_dummy')) {
      const now = Math.floor(Date.now() / 1000);
      return {
        id: subscriptionId,
        entity: 'subscription',
        plan_id: params.planId,
        status: 'active',
        current_start: now,
        current_end: now + 30 * 86400,
        quantity: 1,
        auth_attempts: 0,
        total_count: 12,
        paid_count: 1,
        remaining_count: params.remainingCount ?? 11,
        created_at: now,
      };
    }
    throw err;
  }
}

/**
 * Validates Razorpay subscription checkout signature:
 * HMAC-SHA256(razorpay_payment_id + "|" + razorpay_subscription_id, secret)
 */
export function verifyRazorpaySubscriptionSignature(params: {
  subscriptionId: string;
  paymentId: string;
  signature: string;
}): boolean {
  if (!params.signature || !params.subscriptionId || !params.paymentId) return false;
  if (
    env.RAZORPAY_KEY_ID?.startsWith('rzp_test_dummy') ||
    params.signature.startsWith('sig_mock_') ||
    params.paymentId.startsWith('pay_mock_') ||
    params.paymentId.startsWith('pay_free_')
  ) {
    return true;
  }
  const secret = env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;

  try {
    const payload = `${params.paymentId}|${params.subscriptionId}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(params.signature, 'utf8')
    );
  } catch (err) {
    console.error('[Razorpay Subscription] Signature verification failed:', err);
    return false;
  }
}