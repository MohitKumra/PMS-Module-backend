// backend/src/routes/tasks.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../controllers/tasks.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';

const router = Router();
router.use(authenticate);

const createSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format').optional().or(z.literal('')),
  recurrenceRule: z.string().max(200).optional(),
  parentTaskId: z.string().optional(),
});

const updateSchema = createSchema.partial().extend({
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format').nullable().optional().or(z.literal('')),
  recurrenceRule: z.string().max(200).nullable().optional(),
  attachmentUrl: z.string().url().nullable().optional(),
});

const idParams = z.object({ id: z.string() });

router.get('/',    ctrl.list);
router.get('/:id', validate({ params: idParams }), ctrl.getOne);
router.post('/',   validate({ body: createSchema }), ctrl.create);
router.patch('/:id', validate({ params: idParams, body: updateSchema }), ctrl.update);
router.delete('/:id', validate({ params: idParams }), ctrl.remove);

export default router;