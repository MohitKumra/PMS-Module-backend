// backend/src/providers/razorpay/razorpay.types.ts
// Type definitions for Razorpay entities and webhooks.

export interface RazorpayOrderEntity {
  id: string;
  entity: 'order';
  amount: number; // in paise / cents
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt?: string;
  status: 'created' | 'attempted' | 'paid';
  attempts: number;
  notes?: Record<string, any>;
  created_at: number;
}

export interface RazorpayPaymentEntity {
  id: string;
  entity: 'payment';
  amount: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  order_id?: string;
  invoice_id?: string;
  international?: boolean;
  method?: string;
  amount_refunded?: number;
  refund_status?: string | null;
  captured?: boolean;
  description?: string;
  card_id?: string;
  bank?: string;
  wallet?: string;
  vpa?: string;
  email?: string;
  contact?: string;
  fee?: number;
  tax?: number;
  error_code?: string;
  error_description?: string;
  error_source?: string;
  error_step?: string;
  error_reason?: string;
  created_at: number;
}

export interface RazorpaySubscriptionEntity {
  id: string;
  entity: 'subscription';
  plan_id: string;
  customer_id?: string;
  status: 'created' | 'authenticated' | 'active' | 'pending' | 'halted' | 'cancelled' | 'completed' | 'expired' | 'paused';
  current_start: number;
  current_end: number;
  ended_at?: number | null;
  quantity: number;
  charge_at?: number;
  start_at?: number;
  end_at?: number;
  auth_attempts: number;
  total_count: number;
  paid_count: number;
  remaining_count: number;
  short_url?: string;
  has_scheduled_changes?: boolean;
  change_scheduled_at?: number | null;
  offer_id?: string;
  notes?: Record<string, any>;
  created_at: number;
}

export interface RazorpayRefundEntity {
  id: string;
  entity: 'refund';
  amount: number;
  currency: string;
  payment_id: string;
  notes?: Record<string, any>;
  receipt?: string;
  status: 'pending' | 'processed' | 'failed';
  speed_processed?: string;
  speed_requested?: string;
  created_at: number;
}

export interface RazorpayWebhookPayload {
  entity: string;
  account_id: string;
  event: string;
  contains: string[];
  payload: {
    payment?: { entity: RazorpayPaymentEntity };
    order?: { entity: RazorpayOrderEntity };
    subscription?: { entity: RazorpaySubscriptionEntity };
    refund?: { entity: RazorpayRefundEntity };
  };
  created_at: number;
}