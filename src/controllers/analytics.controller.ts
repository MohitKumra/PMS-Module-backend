// backend/src/controllers/analytics.controller.ts
import { Request, Response, NextFunction } from 'express';
import * as analyticsService from '../services/analytics.service';

export async function summary(req: Request, res: Response, next: NextFunction) {
  try { res.json(await analyticsService.getSummary(req.user!.sub)); } catch (err) { next(err); }
}

export async function daily(req: Request, res: Response, next: NextFunction) {
  try {
    const days = parseInt((req.query.days as string) ?? '30', 10);
    res.json(await analyticsService.getDailyBreakdown(req.user!.sub, days));
  } catch (err) { next(err); }
}
