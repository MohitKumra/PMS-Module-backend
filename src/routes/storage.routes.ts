// backend/src/routes/storage.routes.ts
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { listStorageFiles } from '../controllers/storage.controller';

const router = Router();
router.use(authenticate);

router.get('/', listStorageFiles);

export default router;
