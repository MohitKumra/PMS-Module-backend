// backend/src/routes/custom-plan.routes.ts
// User-facing Custom Plan request endpoints (self-service).
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import {
  createCustomPlanRequestHandler,
  listMyCustomPlanRequestsHandler,
  getMyCustomPlanRequestHandler,
  getCustomPlanPayHandler,
  createCustomPlanPaymentOrderHandler,
  verifyCustomPlanPaymentHandler,
} from '../controllers/customPlan.controller';

const router = Router();

router.post('/', authenticate, createCustomPlanRequestHandler);
router.get('/me', authenticate, listMyCustomPlanRequestsHandler);
// Pay-by-token routes must be registered BEFORE the generic /:id route so the
// literal "pay" segment is never swallowed by the id param.
router.get('/pay/:token', authenticate, getCustomPlanPayHandler);
router.post('/pay/:token/checkout', authenticate, createCustomPlanPaymentOrderHandler);
router.post('/pay/:token/verify-payment', authenticate, verifyCustomPlanPaymentHandler);
router.get('/:id', authenticate, getMyCustomPlanRequestHandler);

export default router;