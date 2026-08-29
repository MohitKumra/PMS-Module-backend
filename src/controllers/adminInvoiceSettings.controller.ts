// backend/src/controllers/adminInvoiceSettings.controller.ts
// Administration endpoints for invoice/billing document settings (SAC, contact,
// notes, currency, invoice prefix, place of supply). Persisted in the database
// via the systemSettings service and applied to newly-created invoices.

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { logAdminAction } from '../services/audit.service';
import {
  getInvoiceSettings,
  updateSystemSettings,
} from '../services/systemSettings.service';

const invoiceSettingsSchema = z.object({
  sac: z.string().max(16).optional(),
  supportEmail: z.string().email().optional().or(z.literal('')),
  notes: z.string().max(500).optional(),
  placeOfSupply: z.string().max(120).optional(),
  currency: z.string().min(3).max(3).optional(),
  invoicePrefix: z.string().min(1).max(12).optional(),
  companyName: z.string().max(120).optional(),
  gstin: z.string().max(32).optional(),
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  cityState: z.string().max(120).optional(),
  pincode: z.string().max(20).optional(),
});

export async function getAdminInvoiceSettingsHandler(_req: Request, res: Response): Promise<void> {
  const settings = await getInvoiceSettings();
  res.json({ success: true, data: settings });
}

export async function updateAdminInvoiceSettingsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = invoiceSettingsSchema.parse(req.body);
    const before = await getInvoiceSettings();

    const updated = await updateSystemSettings(
      { invoice: data } as any,
      req.admin?.sub
    );

    await logAdminAction({
      adminAccountId: req.admin!.sub,
      action: 'INVOICE_SETTINGS_UPDATED',
      entityType: 'Settings',
      before: { invoice: before },
      after: { invoice: updated.invoice },
    });

    res.json({ success: true, message: 'Invoice settings updated successfully', data: updated.invoice });
  } catch (err) {
    next(err);
  }
}
