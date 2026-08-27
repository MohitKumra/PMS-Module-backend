// backend/src/controllers/system.controller.ts
// Public, unauthenticated endpoint the frontend uses to detect maintenance mode.

import type { Request, Response } from 'express';
import { getSystemSettings } from '../services/systemSettings.service';

export async function getMaintenanceStatus(_req: Request, res: Response): Promise<void> {
  const settings = await getSystemSettings();
  res.json({
    maintenanceMode: settings.maintenanceMode,
    message: settings.maintenanceMessage || 'We are currently performing maintenance.',
  });
}