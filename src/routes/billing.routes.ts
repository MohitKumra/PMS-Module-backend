// backend/src/routes/billing.routes.ts
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import {
  getPublicPlans,
  getUserSubscription,
  createCheckout,
  verifyPayment,
  cancelSubscription,
  previewCoupon,
} from '../controllers/billing.controller';

const router = Router();

// Public / Authenticated plans listing
router.get('/plans', getPublicPlans);

// Authenticated user subscription and checkout routes
router.get('/subscription', authenticate, getUserSubscription);
router.post('/apply-coupon', authenticate, previewCoupon);
router.post('/checkout', authenticate, createCheckout);
router.post('/verify-payment', authenticate, verifyPayment);
router.post('/cancel-subscription', authenticate, cancelSubscription);

export default router;
