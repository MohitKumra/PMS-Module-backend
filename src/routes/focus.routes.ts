// backend/src/routes/focus.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../controllers/focus.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';

const router = Router();
router.use(authenticate);

// ─── Schemas ─────────────────────────────────────────────────────────────────

const createSchema = z.object({
  durationMin: z.number().int().min(1).max(480), // up to 8h session
  taskId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  isBreak: z.boolean().optional(),
});

const updateSchema = z.object({
  elapsedMin: z.number().int().min(0).max(480),
  status: z.enum(['IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
});

const timeLogSchema = z.object({
  durationMin: z.number().int().min(1).max(480),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get('/',              ctrl.list);
router.post('/',             validate({ body: createSchema }), ctrl.create);
router.patch('/:id',         validate({ body: updateSchema }), ctrl.update);
router.post('/:id/complete', ctrl.complete);
router.post('/:id/cancel',   ctrl.cancel);
router.get('/active',        ctrl.getActive);
router.post('/time-log',     validate({ body: timeLogSchema }), ctrl.logTime);
router.get('/time-logs',     ctrl.listTimeLogs);

export default router;