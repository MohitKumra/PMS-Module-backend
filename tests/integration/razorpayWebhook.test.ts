// backend/tests/integration/razorpayWebhook.test.ts
// Integration tests for the hardened Razorpay Webhook endpoint.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import app from '../../src/server';
import { prisma } from '../../src/lib/prismaClient';
import { env } from '../../src/config/env';

function generateSignature(payload: string, secret = env.RAZORPAY_WEBHOOK_SECRET || 'rzp_whsec_test_local_secret_secure'): string {
  return crypto.createHmac('sha256', secret).update(Buffer.from(payload, 'utf8')).digest('hex');
}

describe('Razorpay Webhook Endpoint Integration', () => {
  const testSecret = env.RAZORPAY_WEBHOOK_SECRET || 'rzp_whsec_test_local_secret_secure';

  it('rejects requests without an x-razorpay-signature header with 400', async () => {
    const payload = JSON.stringify({ event: 'payment.captured' });
    const res = await request(app)
      .post('/api/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_SIGNATURE');
  });

  it('rejects requests with an invalid signature with 400', async () => {
    const payload = JSON.stringify({ event: 'payment.captured' });
    const res = await request(app)
      .post('/api/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('returns 200 ALREADY_PROCESSED for duplicate webhook events', async () => {
    const eventId = `evt_test_dup_${Date.now()}`;
    // Pre-create the event in PROCESSED state
    await prisma.paymentWebhookEvent.create({
      data: {
        provider: 'razorpay',
        providerEventId: eventId,
        eventType: 'payment.captured',
        payload: { event: 'payment.captured' },
        signature: 'valid_mock_signature',
        processingStatus: 'PROCESSED',
      },
    });

    const payload = JSON.stringify({
      id: eventId,
      event: 'payment.captured',
      payload: {},
    });
    const sig = generateSignature(payload, testSecret);

    const res = await request(app)
      .post('/api/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', sig)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ALREADY_PROCESSED');
    expect(res.body.eventId).toBe(eventId);
  });

  it('handles payment.failed cleanly without throwing and updates order to FAILED', async () => {
    const eventId = `evt_test_failed_${Date.now()}`;
    const testOrderId = `order_failed_test_${Date.now()}`;

    // Create a mock pending order
    const testUser = await prisma.user.findFirst();
    if (!testUser) return; // Skip if no user seeded

    await prisma.paymentOrder.create({
      data: {
        userId: testUser.id,
        type: 'ONE_TIME',
        provider: 'razorpay',
        providerOrderId: testOrderId,
        currency: 'INR',
        subtotalCents: 100000,
        taxCents: 18000,
        totalCents: 118000,
        status: 'CREATED',
      },
    });

    const payload = JSON.stringify({
      id: eventId,
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: `pay_failed_${Date.now()}`,
            order_id: testOrderId,
            amount: 118000,
            currency: 'INR',
            error_code: 'BAD_REQUEST_ERROR',
            error_description: 'Payment was cancelled by the customer',
          },
        },
      },
    });
    const sig = generateSignature(payload, testSecret);

    const res = await request(app)
      .post('/api/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', sig)
      .send(payload);

    expect(res.status).toBe(200);

    // Verify order was marked FAILED
    const updatedOrder = await prisma.paymentOrder.findFirst({
      where: { providerOrderId: testOrderId },
    });
    expect(updatedOrder?.status).toBe('FAILED');
  });
});
