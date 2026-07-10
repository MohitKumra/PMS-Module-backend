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

export async function projects(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await analyticsService.getProjectAnalytics(req.user!.sub));
  } catch (err) { next(err); }
}

export async function weekly(req: Request, res: Response, next: NextFunction) {
  try {
    const weeks = parseInt((req.query.weeks as string) ?? '12', 10);
    res.json(await analyticsService.getWeeklyProgress(req.user!.sub, weeks));
  } catch (err) { next(err); }
}

export async function upcomingDeadlines(req: Request, res: Response, next: NextFunction) {
  try {
    const days = parseInt((req.query.days as string) ?? '7', 10);
    res.json(await analyticsService.getUpcomingDeadlines(req.user!.sub, days));
  } catch (err) { next(err); }
}

