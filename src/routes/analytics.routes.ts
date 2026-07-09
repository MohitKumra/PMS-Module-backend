// backend/src/routes/analytics.routes.ts
import { Router } from 'express';
import * as ctrl from '../controllers/analytics.controller';
import { authenticate } from '../middleware/authenticate';

const router = Router();
router.use(authenticate);

router.get('/summary', ctrl.summary);
router.get('/daily',   ctrl.daily);

export default router;
