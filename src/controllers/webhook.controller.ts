// backend/src/controllers/webhook.controller.ts
// Handles incoming Razorpay webhook delivery with signature verification.

import type { Request, Response } from 'express';
import { processRazorpayWebhook } from '../services/billing.service';

export async function razorpayWebhookHandler(req: Request, res: Response): Promise<void> {
  const signature = req.headers['x-razorpay-signature'] as string | undefined;
  const rawBody: Buffer | string = (req as any).rawBody || req.body;

  if (!signature) {
    console.warn('[Webhook] Rejected request: Missing x-razorpay-signature header');
    res.status(400).json({ error: { code: 'MISSING_SIGNATURE', message: 'Missing Razorpay signature' } });
    return;
  }

  if (!rawBody || (Buffer.isBuffer(rawBody) && rawBody.length === 0)) {
    console.warn('[Webhook] Rejected request: Empty request body');
    res.status(400).json({ error: { code: 'EMPTY_BODY', message: 'Webhook body is empty' } });
    return;
  }

  try {
    const result = await processRazorpayWebhook(rawBody, signature);
    res.status(200).json({ success: true, ...result });
  } catch (err: any) {
    const statusCode = err?.status || err?.statusCode || (err?.code === 'INVALID_SIGNATURE' || err?.code === 'MALFORMED_JSON' ? 400 : 500);
    // Never log secrets or authorization headers
    console.error(`[Webhook] Processing failed [${err?.code || 'INTERNAL_ERROR'}]:`, err?.message);
    res.status(statusCode).json({
      error: {
        code: err?.code || 'WEBHOOK_PROCESSING_FAILED',
        message: err?.message || 'Webhook processing failed',
      },
    });
  }
}