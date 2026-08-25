// backend/src/controllers/webhook.controller.ts
// Handles incoming Razorpay webhook delivery with signature verification.

import type { Request, Response, NextFunction } from 'express';
import { processRazorpayWebhook } from '../services/billing.service';

export async function razorpayWebhookHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const signature = req.headers['x-razorpay-signature'] as string | undefined;
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    const result = await processRazorpayWebhook(rawBody, signature);
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[Webhook Controller Error]', err.message);
    res.status(400).json({
      error: { code: 'WEBHOOK_PROCESSING_FAILED', message: err.message },
    });
  }
}