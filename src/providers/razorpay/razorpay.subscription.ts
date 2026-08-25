// backend/src/providers/razorpay/razorpay.subscription.ts
// Razorpay Subscription and Provider Plan lifecycle functions.

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

export async function createRazorpaySubscription(params: {
  planId: string;
  totalCount?: number;
  quantity?: number;
  customerNotify?: 0 | 1;
  notes?: Record<string, any>;
}): Promise<RazorpaySubscriptionEntity> {
  try {
    return await razorpayRequest<RazorpaySubscriptionEntity>('/subscriptions', {
      method: 'POST',
      body: {
        plan_id: params.planId,
        total_count: params.totalCount || 12,
        quantity: params.quantity || 1,
        customer_notify: params.customerNotify ?? 1,
        notes: params.notes,
      },
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