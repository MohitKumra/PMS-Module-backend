// backend/src/routes/webhook.routes.ts
// Router for provider webhook ingestion with raw body parser.

import { Router } from 'express';
import express from 'express';
import { razorpayWebhookHandler } from '../controllers/webhook.controller';

const router = Router();

// Use express.raw or express.text to preserve raw bytes for HMAC-SHA256 signature verification
router.post(
  '/razorpay',
  express.text({ type: ['application/json', 'text/plain', '*/*'] }),
  razorpayWebhookHandler
);

export default router;