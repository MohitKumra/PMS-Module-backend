import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../controllers/calendar.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';

const router = Router();
router.use(authenticate);

const overviewQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
});

router.get('/overview', validate({ query: overviewQuerySchema }), ctrl.overview);

export default router;
