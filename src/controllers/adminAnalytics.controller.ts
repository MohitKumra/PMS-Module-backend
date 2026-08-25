// backend/src/controllers/adminAnalytics.controller.ts
// Administration endpoints for analytics and business metrics.

import type { Request, Response, NextFunction } from 'express';
import { getAdminOverviewMetrics, getRevenueAnalytics } from '../services/adminAnalytics.service';

export async function getOverviewMetricsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
    const metrics = await getAdminOverviewMetrics(days);
    res.json({ success: true, data: metrics });
  } catch (err) {
    next(err);
  }
}

export async function getRevenueAnalyticsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
    const data = await getRevenueAnalytics(days);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}