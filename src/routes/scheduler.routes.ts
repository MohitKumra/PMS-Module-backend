import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../controllers/scheduler.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';

const router = Router();
router.use(authenticate);

const dateParamSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format')
    .optional(),
});

const suggestBodySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format')
    .optional(),
});

const applyBodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  blocks: z
    .array(
      z.object({
        taskId: z.string(),
        taskTitle: z.string(),
        priority: z.string(),
        estimatedDuration: z.number(),
        scheduledStart: z.string().nullable(),
        scheduledEnd: z.string().nullable(),
      })
    )
    .min(1),
});

router.get('/capacity', validate({ query: dateParamSchema }), ctrl.getCapacity);
router.post('/suggest', validate({ body: suggestBodySchema }), ctrl.suggestSchedule);
router.post('/apply', validate({ body: applyBodySchema }), ctrl.applySchedule);

export default router;
