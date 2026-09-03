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
  if (!signature || typeof signature !== 'string') return false;
  const secret = webhookSecret || env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[RazorpayWebhook] Signature verification rejected: Webhook secret is not configured.');
    return false;
  }

  try {
    const rawBuffer = Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.from(typeof rawBody === 'string' ? rawBody : '', 'utf8');

    if (rawBuffer.length === 0) return false;

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBuffer)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSignature, 'utf8');
    const signatureBuf = Buffer.from(signature.trim(), 'utf8');

    if (expectedBuf.length !== signatureBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, signatureBuf);
  } catch (err: any) {
    console.error('[RazorpayWebhook] Signature verification error:', err?.message);
    return false;
  }
}