// backend/src/routes/storage.routes.ts
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import {
  listStorageFiles,
  deleteStorageFile,
  batchDeleteStorageFiles,
} from '../controllers/storage.controller';

const router = Router();
router.use(authenticate);

router.get('/', listStorageFiles);
router.delete('/:id', deleteStorageFile);
router.post('/batch-delete', batchDeleteStorageFiles);

export default router;

