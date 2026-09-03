// backend/src/routes/webhook.routes.ts
// Router for provider webhook ingestion with raw body preservation.

import { Router } from 'express';
import express from 'express';
import { razorpayWebhookHandler } from '../controllers/webhook.controller';

const router = Router();

// Ensure raw byte Buffer is preserved for HMAC-SHA256 signature verification
router.post(
  '/razorpay',
  (req, res, next) => {
    if ((req as any).rawBody) {
      return next();
    }
    express.raw({ type: '*/*', limit: '5mb' })(req, res, (err) => {
      if (err) return next(err);
      (req as any).rawBody = req.body;
      next();
    });
  },
  razorpayWebhookHandler
);

export default router;