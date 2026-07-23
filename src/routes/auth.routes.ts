// backend/src/routes/auth.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../controllers/auth.controller';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';

const router = Router();

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().max(100).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const forgotSchema = z.object({ email: z.string().email() });
const resetSchema  = z.object({ token: z.string(), password: z.string().min(8) });
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(8),
});
const setPasswordSchema = z.object({
  newPassword: z.string().min(8),
});

router.post('/signup',         validate({ body: signupSchema }), ctrl.signup);
router.post('/login',          validate({ body: loginSchema }),  ctrl.login);
router.post('/refresh',        ctrl.refresh);
router.post('/logout',         ctrl.logout);
router.post('/forgot-password',validate({ body: forgotSchema }), ctrl.forgotPassword);
router.post('/forgot-password/recovery', validate({ body: z.object({ recoveryEmail: z.string().email() }) }), ctrl.forgotPasswordByRecoveryEmail);
router.post('/reset-password', validate({ body: resetSchema }),  ctrl.resetPassword);
router.get('/me',              authenticate, ctrl.getMe);
router.get('/google/start',    ctrl.googleStart);
router.get('/google/callback', ctrl.googleCallback);
router.post('/change-password', authenticate, validate({ body: changePasswordSchema }), ctrl.changePassword);
router.post('/set-password', authenticate, validate({ body: setPasswordSchema }), ctrl.setPassword);

export default router;
