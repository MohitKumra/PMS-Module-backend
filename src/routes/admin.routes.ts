// backend/src/routes/admin.routes.ts
// Administration router mounting all protected admin resources and authentication.

import { Router } from 'express';
import {
  sendOtpHandler,
  verifyOtpHandler,
  refreshHandler,
  logoutHandler,
  getMeHandler,
} from '../controllers/adminAuth.controller';
import {
  listUsersHandler,
  getUserDetailHandler,
  deactivateUserHandler,
  reactivateUserHandler,
  banUserHandler,
  overrideEntitlementHandler,
  revokeEntitlementHandler,
} from '../controllers/adminUsers.controller';
import {
  listPlansHandler,
  getPlanDetailHandler,
  createPlanHandler,
  updatePlanHandler,
} from '../controllers/adminPlans.controller';
import {
  listCouponsHandler,
  getCouponDetailHandler,
  createCouponHandler,
  updateCouponHandler,
  validateCouponHandler,
} from '../controllers/adminCoupons.controller';
import {
  listTransactionsHandler,
  getTransactionDetailHandler,
  processRefundHandler,
  listSubscriptionsHandler,
  getSubscriptionDetailHandler,
  cancelSubscriptionHandler,
  pauseSubscriptionHandler,
  resumeSubscriptionHandler,
  createCheckoutHandler,
  verifyPaymentHandler,
} from '../controllers/adminBilling.controller';
import {
  getOverviewMetricsHandler,
  getRevenueAnalyticsHandler,
} from '../controllers/adminAnalytics.controller';
import { listAuditLogsHandler } from '../controllers/adminAudit.controller';
import { getSystemHealthHandler, runReconciliationHandler } from '../controllers/adminSystem.controller';
import { getAdminSettingsHandler, updateAdminSettingsHandler } from '../controllers/adminSettings.controller';
import {
  getAdminInvoiceSettingsHandler,
  updateAdminInvoiceSettingsHandler,
} from '../controllers/adminInvoiceSettings.controller';
import {
  listCustomPlanRequestsHandler,
  getCustomPlanRequestHandler,
  updateCustomPlanRequestHandler,
  countCustomPlanRequestsHandler,
} from '../controllers/adminCustomPlans.controller';

import { requireAdmin } from '../middleware/requireAdmin';
import { requirePermission } from '../middleware/requirePermission';
import { adminSendOtpLimiter, adminVerifyOtpLimiter } from '../middleware/adminRateLimiter';

const router = Router();

// ─── Public Admin Auth Endpoints ──────────────────────────────────────────
router.post('/auth/send-otp', adminSendOtpLimiter, sendOtpHandler);
router.post('/auth/verify-otp', adminVerifyOtpLimiter, verifyOtpHandler);
router.post('/auth/refresh', refreshHandler);
router.post('/auth/logout', logoutHandler);
router.get('/auth/me', requireAdmin, getMeHandler);

// ─── Dashboard Overview & Analytics ───────────────────────────────────────
router.get('/overview', requireAdmin, requirePermission('analytics.read'), getOverviewMetricsHandler);
router.get('/analytics/revenue', requireAdmin, requirePermission('analytics.read'), getRevenueAnalyticsHandler);

// ─── User Administration ──────────────────────────────────────────────────
router.get('/users', requireAdmin, requirePermission('users.read'), listUsersHandler);
router.get('/users/:id', requireAdmin, requirePermission('users.read'), getUserDetailHandler);
router.patch('/users/:id/deactivate', requireAdmin, requirePermission('users.deactivate'), deactivateUserHandler);
router.patch('/users/:id/reactivate', requireAdmin, requirePermission('users.deactivate'), reactivateUserHandler);
router.patch('/users/:id/ban', requireAdmin, requirePermission('users.ban'), banUserHandler);
router.post('/users/:id/override-entitlement', requireAdmin, requirePermission('admins.manage'), overrideEntitlementHandler);
router.patch('/users/:id/revoke-entitlement/:overrideId', requireAdmin, requirePermission('admins.manage'), revokeEntitlementHandler);

// ─── Plans Management ─────────────────────────────────────────────────────
router.get('/plans', requireAdmin, requirePermission('plans.read'), listPlansHandler);
router.get('/plans/:id', requireAdmin, requirePermission('plans.read'), getPlanDetailHandler);
router.post('/plans', requireAdmin, requirePermission('plans.write'), createPlanHandler);
router.put('/plans/:id', requireAdmin, requirePermission('plans.write'), updatePlanHandler);

// ─── Coupons Management ───────────────────────────────────────────────────
router.get('/coupons', requireAdmin, requirePermission('coupons.read'), listCouponsHandler);
router.get('/coupons/:id', requireAdmin, requirePermission('coupons.read'), getCouponDetailHandler);
router.post('/coupons', requireAdmin, requirePermission('coupons.write'), createCouponHandler);
router.put('/coupons/:id', requireAdmin, requirePermission('coupons.write'), updateCouponHandler);
router.post('/coupons/validate', validateCouponHandler); // Public/Client helper

// ─── Subscriptions & Billing Ledger ───────────────────────────────────────
router.get('/subscriptions', requireAdmin, requirePermission('billing.read'), listSubscriptionsHandler);
router.get('/subscriptions/:id', requireAdmin, requirePermission('billing.read'), getSubscriptionDetailHandler);
router.patch('/subscriptions/:id/cancel', requireAdmin, requirePermission('billing.refund'), cancelSubscriptionHandler);
router.patch('/subscriptions/:id/pause', requireAdmin, requirePermission('billing.refund'), pauseSubscriptionHandler);
router.patch('/subscriptions/:id/resume', requireAdmin, requirePermission('billing.refund'), resumeSubscriptionHandler);

router.get('/transactions', requireAdmin, requirePermission('billing.read'), listTransactionsHandler);
router.get('/transactions/:id', requireAdmin, requirePermission('billing.read'), getTransactionDetailHandler);
router.post('/transactions/:id/refund', requireAdmin, requirePermission('billing.refund'), processRefundHandler);
router.post('/billing/transactions/:id/refund', requireAdmin, requirePermission('billing.refund'), processRefundHandler);

// ─── Audit Log, System Health & Settings ───────────────────────────────────
router.get('/audit-log', requireAdmin, requirePermission('audit.read'), listAuditLogsHandler);
router.get('/system', requireAdmin, requirePermission('system.read'), getSystemHealthHandler);
router.post('/system/reconciliation', requireAdmin, requirePermission('admins.manage'), runReconciliationHandler);
router.get('/settings', requireAdmin, requirePermission('system.read'), getAdminSettingsHandler);
router.put('/settings', requireAdmin, requirePermission('admins.manage'), updateAdminSettingsHandler);

// ─── Invoice / Billing Document Settings ────────────────────────────────────
router.get('/billing/invoice-settings', requireAdmin, requirePermission('billing.read'), getAdminInvoiceSettingsHandler);
router.put('/billing/invoice-settings', requireAdmin, requirePermission('billing.refund'), updateAdminInvoiceSettingsHandler);

// ─── Custom Plan Requests ────────────────────────────────────────────────────
// count must be registered BEFORE the /custom-plans/:id param route.
router.get('/custom-plans/count', requireAdmin, requirePermission('plans.read'), countCustomPlanRequestsHandler);
router.get('/custom-plans', requireAdmin, requirePermission('plans.read'), listCustomPlanRequestsHandler);
router.get('/custom-plans/:id', requireAdmin, requirePermission('plans.read'), getCustomPlanRequestHandler);
router.patch('/custom-plans/:id', requireAdmin, requirePermission('plans.write'), updateCustomPlanRequestHandler);

export default router;