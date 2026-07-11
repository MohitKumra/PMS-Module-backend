// backend/src/routes/search.routes.ts
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import * as ctrl from '../controllers/search.controller';

const router = Router();
router.use(authenticate);

router.get('/', ctrl.searchHandler);

export default router;
