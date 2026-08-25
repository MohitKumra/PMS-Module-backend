// backend/src/controllers/adminSystem.controller.ts
// Administration endpoints for system health and reconciliation.

import type { Request, Response, NextFunction } from 'express';
import { getSystemHealthOverview } from '../services/systemHealth.service';
import { runBillingReconciliation } from '../services/reconciliation.service';

export async function getSystemHealthHandler(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const health = await getSystemHealthOverview();
    res.json({ success: true, data: health });
  } catch (err) {
    next(err);
  }
}

export async function runReconciliationHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await runBillingReconciliation(req.admin?.sub);
    res.json({ success: true, message: 'Reconciliation check completed', data: result });
  } catch (err) {
    next(err);
  }
}