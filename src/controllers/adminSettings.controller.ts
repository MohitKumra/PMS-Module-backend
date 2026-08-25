// backend/src/controllers/adminSettings.controller.ts
// Administration endpoints for application display and operational settings.

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { logAdminAction } from '../services/audit.service';

const settingsSchema = z.object({
  appName: z.string().min(1).max(50).optional(),
  supportEmail: z.string().email().optional(),
  defaultCurrency: z.string().min(3).max(3).optional(),
  defaultTimezone: z.string().optional(),
  maintenanceMode: z.boolean().optional(),
});

// Stored application configuration in-memory/cache (can be persisted)
let systemSettings = {
  appName: 'Finamite Productivity',
  supportEmail: 'support@finamite.com',
  defaultCurrency: 'USD',
  defaultTimezone: 'UTC',
  maintenanceMode: false,
  updatedAt: new Date().toISOString(),
};

export async function getAdminSettingsHandler(_req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: systemSettings });
}

export async function updateAdminSettingsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = settingsSchema.parse(req.body);
    const before = { ...systemSettings };

    systemSettings = {
      ...systemSettings,
      ...data,
      updatedAt: new Date().toISOString(),
    };

    if (req.admin) {
      await logAdminAction({
        adminAccountId: req.admin.sub,
        action: 'SYSTEM_SETTINGS_UPDATED',
        entityType: 'Settings',
        before,
        after: systemSettings,
      });
    }

    res.json({ success: true, message: 'Settings updated successfully', data: systemSettings });
  } catch (err) {
    next(err);
  }
}