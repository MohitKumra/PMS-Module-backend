// backend/src/routes/habits.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../controllers/habits.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';

const router = Router();
router.use(authenticate);

const createSchema = z.object({
  title: z.string().min(1).max(200),
  targetPerWeek: z.number().int().min(1).max(7).optional(),
  reminderTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format HH:mm').optional(),
});

const idParams = z.object({ id: z.string() });

router.get('/',              ctrl.list);
router.post('/',             validate({ body: createSchema }), ctrl.create);
router.patch('/:id',         validate({ params: idParams, body: createSchema.partial() }), ctrl.update);
router.delete('/:id',        validate({ params: idParams }), ctrl.remove);
router.post('/:id/toggle',   validate({ params: idParams }), ctrl.toggle);
router.get('/week-overview', ctrl.weekOverview);

export default router;
