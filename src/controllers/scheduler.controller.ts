import { Request, Response, NextFunction } from 'express';
import * as schedulerService from '../services/scheduler.service';

export async function getCapacity(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.sub;
    const date = req.query.date ? new Date(String(req.query.date)) : new Date();
    const capacity = await schedulerService.getCapacityForDate(userId, date);
    res.json({
      date: date.toISOString().split('T')[0],
      ...capacity,
    });
  } catch (err) {
    next(err);
  }
}

export async function suggestSchedule(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.sub;
    const date = req.body.date ? new Date(String(req.body.date)) : new Date();
    const suggestion = await schedulerService.suggestSchedule(userId, date);
    res.json(suggestion);
  } catch (err) {
    next(err);
  }
}

export async function applySchedule(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.sub;
    const { date, blocks } = req.body;
    if (!date || !blocks || !Array.isArray(blocks)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'date and blocks are required' } });
      return;
    }
    const created = await schedulerService.applySchedule(userId, new Date(date), blocks);
    res.json({ created, date });
  } catch (err) {
    next(err);
  }
}