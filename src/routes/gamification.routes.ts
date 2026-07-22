import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import * as ctrl from '../controllers/gamification.controller';

const router = Router();
router.use(authenticate);

router.get('/profile', ctrl.profile);
router.get('/achievements', ctrl.achievements);

export default router;
