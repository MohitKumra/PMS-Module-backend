// backend/src/providers/razorpay/razorpay.webhook.ts
// Webhook signature verification and validation for Razorpay events.

import crypto from 'crypto';
import { env } from '../../config/env';

/**
 * Validates the Razorpay webhook signature against the raw request body.
 * @param rawBody - Raw request body as UTF-8 string or Buffer.
 * @param signature - The signature sent in the `x-razorpay-signature` header.
 * @param webhookSecret - Optional override, defaults to env.RAZORPAY_WEBHOOK_SECRET.
 */
export function verifyRazorpayWebhookSignature(
  rawBody: string | Buffer,
  signature: string | undefined | null,
  webhookSecret?: string
): boolean {
  if (!signature) return false;
  const secret = webhookSecret || env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;

  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'))
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'utf8'),
      Buffer.from(signature, 'utf8')
    );
  } catch (err) {
    console.error('[RazorpayWebhook] Signature verification error:', err);
    return false;
  }
}