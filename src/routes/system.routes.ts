// backend/src/routes/system.routes.ts
// Public system endpoints (maintenance status, etc.).

import { Router } from 'express';
import { getMaintenanceStatus } from '../controllers/system.controller';

const router = Router();

// Public — must remain reachable even during maintenance so clients can detect it.
router.get('/maintenance', getMaintenanceStatus);

export default router;