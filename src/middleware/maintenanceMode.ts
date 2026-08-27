// backend/src/middleware/maintenanceMode.ts
// Blocks all non-admin traffic with 503 when maintenance mode is active.
// Admin routes (/api/admin), health/ready, and the maintenance-status endpoint
// remain reachable so the team can still operate and toggle things off.

import type { Request, Response, NextFunction } from 'express';
import { isMaintenanceMode } from '../services/systemSettings.service';

export async function maintenanceMode(req: Request, res: Response, next: NextFunction): Promise<void> {
  const path = req.originalUrl || req.path || '';

  if (isAdminOrPublic(path)) {
    return next();
  }

  const active = await isMaintenanceMode();
  if (active) {
    res.status(503).json({
      error: {
        code: 'MAINTENANCE_MODE',
        message: 'We are currently performing maintenance. Please check back shortly.',
      },
    });
    return;
  }

  next();
}

function isAdminOrPublic(path: string): boolean {
  if (path.startsWith('/api/admin')) return true;
  if (path === '/health' || path === '/ready') return true;
  if (path.startsWith('/api/system/maintenance')) return true;
  return false;
}