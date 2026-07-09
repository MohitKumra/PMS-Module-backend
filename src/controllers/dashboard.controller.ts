// backend/src/controllers/dashboard.controller.ts
import { Request, Response, NextFunction } from 'express';
import * as dashboardService from '../services/dashboard.service';

export async function summary(req: Request, res: Response, next: NextFunction) {
  try {
    const summary = await dashboardService.getDashboardSummary(req.user!.sub);
    res.json(summary);
  } catch (err) { next(err); }
}

export async function today(req: Request, res: Response, next: NextFunction) {
  try {
    const [pendingTasks, habitsToComplete] = await Promise.all([
      dashboardService.getPendingTasksCount(req.user!.sub),
      dashboardService.getHabitsToCompleteToday(req.user!.sub),
    ]);
    res.json({ pendingTasks, habitsToComplete });
  } catch (err) { next(err); }
}