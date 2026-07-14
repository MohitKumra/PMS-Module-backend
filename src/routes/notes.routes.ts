// backend/src/routes/notes.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../controllers/notes.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';

const router = Router();
router.use(authenticate);

const createSchema = z.object({
  title: z.string().max(500).optional(),
  content: z.string().min(1),
  isJournal: z.boolean().optional(),
  taskId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
});
const idParams = z.object({ id: z.string() });

router.get('/',     ctrl.list);
router.get('/:id',  validate({ params: idParams }), ctrl.getOne);
router.post('/',    validate({ body: createSchema }), ctrl.create);
router.patch('/:id',validate({ params: idParams, body: createSchema.partial() }), ctrl.update);
router.delete('/:id',validate({ params: idParams }), ctrl.remove);

export default router;
