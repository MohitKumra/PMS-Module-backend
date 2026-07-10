// backend/src/routes/analytics.routes.ts
import { Router } from 'express';
import * as ctrl from '../controllers/analytics.controller';
import { authenticate } from '../middleware/authenticate';

const router = Router();
router.use(authenticate);

router.get('/summary', ctrl.summary);
router.get('/daily', ctrl.daily);
router.get('/projects', ctrl.projects);
router.get('/weekly', ctrl.weekly);
router.get('/upcoming-deadlines', ctrl.upcomingDeadlines);

export default router;
