// backend/src/routes/billing.routes.ts
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import {
  getPublicPlans,
  getUserSubscription,
  getUpgradePreview,
  createCheckout,
  verifyPayment,
  cancelSubscription,
  previewCoupon,
  getInvoicePdf,
  getBillingProfile,
  updateBillingProfile,
  scheduleDowngrade,
  cancelScheduledDowngradeHandler,
} from '../controllers/billing.controller';

const router = Router();

// Public / Authenticated plans listing
router.get('/plans', getPublicPlans);

// Authenticated user subscription and checkout routes
router.get('/subscription', authenticate, getUserSubscription);
router.get('/upgrade-preview', authenticate, getUpgradePreview);
router.get('/profile', authenticate, getBillingProfile);
router.put('/profile', authenticate, updateBillingProfile);
router.post('/apply-coupon', authenticate, previewCoupon);
router.post('/checkout', authenticate, createCheckout);
router.post('/verify-payment', authenticate, verifyPayment);
router.post('/cancel-subscription', authenticate, cancelSubscription);
router.post('/downgrade', authenticate, scheduleDowngrade);
router.post('/cancel-downgrade', authenticate, cancelScheduledDowngradeHandler);
router.get('/invoices/:id/pdf', authenticate, getInvoicePdf);

export default router;
