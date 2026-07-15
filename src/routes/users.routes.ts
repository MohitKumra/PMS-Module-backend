import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import * as ctrl from '../controllers/users.controller';

const router = Router();
router.use(authenticate);

router.post('/me/avatar', ctrl.updateAvatar);
router.delete('/me/avatar', ctrl.removeAvatar);

export default router;
