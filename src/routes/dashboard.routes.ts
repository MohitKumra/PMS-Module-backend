// backend/src/routes/dashboard.routes.ts
import { Router } from 'express';
import * as ctrl from '../controllers/dashboard.controller';
import { authenticate } from '../middleware/authenticate';

const router = Router();
router.use(authenticate);

router.get('/summary', ctrl.summary);
router.get('/today', ctrl.today);
router.get('/enhanced', ctrl.enhanced);

export default router;
