// backend/src/routes/notifications.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../controllers/notifications.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';

const router = Router();
router.use(authenticate);

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const testSchema = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  channels: z.array(z.enum(['BROWSER_PUSH', 'EMAIL', 'NATIVE_LOCAL'])).optional(),
});

router.get('/vapid-key',   ctrl.getVapidKey);
router.post('/subscribe',   validate({ body: subscribeSchema }), ctrl.subscribe);
router.post('/unsubscribe', ctrl.unsubscribe);
router.get('/logs',         ctrl.getLogs);
router.post('/read',        ctrl.markAsRead);
router.post('/test',        validate({ body: testSchema }), ctrl.sendTestNotification);

export default router;
