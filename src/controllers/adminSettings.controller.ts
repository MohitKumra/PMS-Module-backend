// backend/src/controllers/adminSettings.controller.ts
// Administration endpoints for application display and operational settings,
// persisted in the database via the systemSettings service.

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { logAdminAction } from '../services/audit.service';
import {
  getSystemSettings,
  updateSystemSettings,
} from '../services/systemSettings.service';

const settingsSchema = z.object({
  appName: z.string().min(1).max(50).optional(),
  supportEmail: z.string().email().optional(),
  defaultCurrency: z.string().min(3).max(3).optional(),
  defaultTimezone: z.string().optional(),
  maintenanceMode: z.boolean().optional(),
  maintenanceMessage: z.string().nullable().optional(),
});

export async function getAdminSettingsHandler(_req: Request, res: Response): Promise<void> {
  const settings = await getSystemSettings();
  res.json({ success: true, data: settings });
}

export async function updateAdminSettingsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = settingsSchema.parse(req.body);
    const before = await getSystemSettings();

    const updated = await updateSystemSettings(data, req.admin?.sub);

    await logAdminAction({
      adminAccountId: req.admin!.sub,
      action: 'SYSTEM_SETTINGS_UPDATED',
      entityType: 'Settings',
      before,
      after: updated,
    });

    res.json({ success: true, message: 'Settings updated successfully', data: updated });
  } catch (err) {
    next(err);
  }
}
