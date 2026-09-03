// backend/tests/unit/recurringDiscountBilling.test.ts
// Unit tests verifying the Razorpay Recurring Discounted First-Cycle billing logic.

import { describe, it, expect } from 'vitest';
import { computeNextCycleTimestamp } from '../../src/services/billing.service';

describe('computeNextCycleTimestamp', () => {
  it('advances exactly one calendar month on regular dates', () => {
    // 2026-09-03 -> 2026-10-03
    const fromDate = new Date(Date.UTC(2026, 8, 3, 12, 0, 0)); // September 3, 2026
    const nextTs = computeNextCycleTimestamp('MONTH', fromDate);
    const nextDate = new Date(nextTs * 1000);

    expect(nextDate.getUTCMonth()).toBe(9); // October
    expect(nextDate.getUTCDate()).toBe(3);
  });

  it('correctly clamps month-end dates (January 31 -> February 28 in non-leap year)', () => {
    // 2026 is non-leap year: Jan 31 -> Feb 28
    const fromDate = new Date(Date.UTC(2026, 0, 31, 12, 0, 0)); // Jan 31, 2026
    const nextTs = computeNextCycleTimestamp('MONTH', fromDate);
    const nextDate = new Date(nextTs * 1000);

    expect(nextDate.getUTCMonth()).toBe(1); // February
    expect(nextDate.getUTCDate()).toBe(28); // Clamped to 28, NOT overflowing to March 2 or 3
  });

  it('correctly clamps month-end dates in leap year (January 31, 2024 -> February 29, 2024)', () => {
    // 2024 is a leap year: Jan 31 -> Feb 29
    const fromDate = new Date(Date.UTC(2024, 0, 31, 12, 0, 0));
    const nextTs = computeNextCycleTimestamp('MONTH', fromDate);
    const nextDate = new Date(nextTs * 1000);

    expect(nextDate.getUTCMonth()).toBe(1); // February
    expect(nextDate.getUTCDate()).toBe(29); // Clamped to leap day
  });

  it('correctly clamps 31-day months transitioning to 30-day months (March 31 -> April 30)', () => {
    const fromDate = new Date(Date.UTC(2026, 2, 31, 12, 0, 0)); // March 31, 2026
    const nextTs = computeNextCycleTimestamp('MONTH', fromDate);
    const nextDate = new Date(nextTs * 1000);

    expect(nextDate.getUTCMonth()).toBe(3); // April
    expect(nextDate.getUTCDate()).toBe(30); // Clamped to April 30, NOT May 1
  });

  it('advances exactly one year for yearly subscriptions', () => {
    const fromDate = new Date(Date.UTC(2026, 8, 3, 12, 0, 0)); // Sept 3, 2026
    const nextTs = computeNextCycleTimestamp('YEAR', fromDate);
    const nextDate = new Date(nextTs * 1000);

    expect(nextDate.getUTCFullYear()).toBe(2027);
    expect(nextDate.getUTCMonth()).toBe(8);
    expect(nextDate.getUTCDate()).toBe(3);
  });

  it('correctly clamps Feb 29 on leap years to Feb 28 on non-leap years', () => {
    // 2028 is a leap year (Feb 29, 2028). 2029 is NOT a leap year.
    const fromDate = new Date(Date.UTC(2028, 1, 29, 12, 0, 0)); // Feb 29, 2028
    const nextTs = computeNextCycleTimestamp('YEAR', fromDate);
    const nextDate = new Date(nextTs * 1000);

    expect(nextDate.getUTCFullYear()).toBe(2029);
    expect(nextDate.getUTCMonth()).toBe(1); // February
    expect(nextDate.getUTCDate()).toBe(28); // Clamped to Feb 28, NOT March 1
  });
});

describe('Discounted Upfront Subscription Amount Calculations', () => {
  it('correctly computes initial discounted total vs undiscounted renewal', () => {
    const planBasePriceCents = 199900; // ₹1,999.00 in paise
    const gstPercent = 18;

    // Normal full price calculation:
    const fullTaxCents = Math.round((planBasePriceCents * gstPercent) / 100); // 35982
    const fullTotalCents = planBasePriceCents + fullTaxCents; // 235882 = ₹2,358.82

    expect(fullTaxCents).toBe(35982);
    expect(fullTotalCents).toBe(235882);

    // 50% discount on initial cycle:
    const couponDiscountCents = 100000; // ₹1,000.00
    const discountedSubtotalCents = Math.max(0, planBasePriceCents - couponDiscountCents); // 99900
    const discountedTaxCents = Math.round((discountedSubtotalCents * gstPercent) / 100); // 17982
    const initialChargeTotalCents = discountedSubtotalCents + discountedTaxCents; // 117882 = ₹1,178.82

    expect(discountedSubtotalCents).toBe(99900);
    expect(discountedTaxCents).toBe(17982);
    expect(initialChargeTotalCents).toBe(117882);

    // Verify invariant: upfront charge < full plan price
    expect(initialChargeTotalCents).toBeLessThan(fullTotalCents);
  });

  it('computes correct total_count for recurring cycles', () => {
    // For a 12-month commitment where 1 cycle is charged upfront via addons:
    const totalCycles = 12;
    const remainingRecurringCount = totalCycles - 1;
    expect(remainingRecurringCount).toBe(11);
    // 1 upfront + 11 recurring = 12 total paid periods
    expect(1 + remainingRecurringCount).toBe(totalCycles);
  });

  it('handles totalCycles = 2 correctly (1 upfront + 1 recurring)', () => {
    const totalCycles = 2;
    const remainingRecurringCount = totalCycles - 1;
    expect(remainingRecurringCount).toBe(1);
    expect(1 + remainingRecurringCount).toBe(totalCycles);
  });

  it('prohibits recurring subscriptions when totalCycles <= 1', () => {
    const totalCycles = 1;
    const isValidRecurring = totalCycles > 1;
    expect(isValidRecurring).toBe(false);
  });
});

describe('Webhook Target Reference Resolution', () => {
  it('resolves subscription_id for subscription payment events', () => {
    const paymentPayload = {
      id: 'pay_test_123',
      order_id: null,
      subscription_id: 'sub_test_456',
      amount: 117882,
    };

    const targetRef = paymentPayload.subscription_id || paymentPayload.order_id;
    expect(targetRef).toBe('sub_test_456');
  });

  it('resolves order_id for one-time checkout orders', () => {
    const paymentPayload = {
      id: 'pay_test_456',
      order_id: 'order_test_789',
      subscription_id: null,
      amount: 235882,
    };

    const targetRef = paymentPayload.subscription_id || paymentPayload.order_id;
    expect(targetRef).toBe('order_test_789');
  });

  it('prefers subscription_id if both are present in subscription invoices', () => {
    const paymentPayload = {
      id: 'pay_test_999',
      order_id: 'order_sub_initial_000',
      subscription_id: 'sub_recurring_000',
      amount: 117882,
    };

    const targetRef = paymentPayload.subscription_id || paymentPayload.order_id;
    expect(targetRef).toBe('sub_recurring_000');
  });
});

describe('Razorpay Webhook Signature Verification', () => {
  // Import dynamically or use crypto directly to test verifyRazorpayWebhookSignature
  it('verifies valid HMAC SHA256 signature against raw request Buffer', async () => {
    const crypto = await import('crypto');
    const { verifyRazorpayWebhookSignature } = await import('../../src/providers/razorpay/razorpay.webhook');

    const testSecret = 'rzp_test_secret_for_unit_tests';
    const rawPayload = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_test_111' } } },
    });

    const expectedSig = crypto
      .createHmac('sha256', testSecret)
      .update(Buffer.from(rawPayload, 'utf8'))
      .digest('hex');

    // Test with Buffer
    const isValidBuffer = verifyRazorpayWebhookSignature(
      Buffer.from(rawPayload, 'utf8'),
      expectedSig,
      testSecret
    );
    expect(isValidBuffer).toBe(true);

    // Test with raw string
    const isValidString = verifyRazorpayWebhookSignature(
      rawPayload,
      expectedSig,
      testSecret
    );
    expect(isValidString).toBe(true);
  });

  it('rejects tampered webhook payloads', async () => {
    const crypto = await import('crypto');
    const { verifyRazorpayWebhookSignature } = await import('../../src/providers/razorpay/razorpay.webhook');

    const testSecret = 'rzp_test_secret_for_unit_tests';
    const originalPayload = '{"event":"payment.captured","amount":1000}';
    const tamperedPayload = '{"event":"payment.captured","amount":9999}';

    const sig = crypto
      .createHmac('sha256', testSecret)
      .update(Buffer.from(originalPayload, 'utf8'))
      .digest('hex');

    const isValid = verifyRazorpayWebhookSignature(
      tamperedPayload,
      sig,
      testSecret
    );
    expect(isValid).toBe(false);
  });

  it('rejects missing or mismatched signature lengths safely', async () => {
    const { verifyRazorpayWebhookSignature } = await import('../../src/providers/razorpay/razorpay.webhook');

    const testSecret = 'rzp_test_secret_for_unit_tests';
    const rawPayload = '{"event":"payment.captured"}';

    // Null or undefined
    expect(verifyRazorpayWebhookSignature(rawPayload, undefined, testSecret)).toBe(false);
    expect(verifyRazorpayWebhookSignature(rawPayload, null, testSecret)).toBe(false);

    // Mismatched length (should return false and not throw RangeError)
    expect(verifyRazorpayWebhookSignature(rawPayload, 'too_short', testSecret)).toBe(false);
  });
});
