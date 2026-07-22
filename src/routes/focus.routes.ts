// backend/src/routes/focus.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../controllers/focus.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';

const router = Router();
router.use(authenticate);

const logSchema = z.object({
  durationMin: z.number().int().min(1).max(120),
  startedAt: z.string().datetime({ offset: true }),
  completed: z.boolean(),
  taskId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  isBreak: z.boolean().optional(),
});

const timeLogSchema = z.object({
  durationMin: z.number().int().min(1).max(120),
});

router.get('/',          ctrl.list);
router.post('/',         validate({ body: logSchema }), ctrl.log);
router.post('/time-log', validate({ body: timeLogSchema }), ctrl.logTime);
router.get('/time-logs', ctrl.listTimeLogs);

export default router;
