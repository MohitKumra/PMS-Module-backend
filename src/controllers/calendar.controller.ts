import { Request, Response, NextFunction } from 'express';
import * as calendarService from '../services/calendar.service';

export async function overview(req: Request, res: Response, next: NextFunction) {
  try {
    const from = String(req.query.from ?? '');
    const to = String(req.query.to ?? '');
    const data = await calendarService.getCalendarOverview(req.user!.sub, { from, to });
    res.json(data);
  } catch (err) {
    next(err);
  }
}
