// backend/src/controllers/habits.controller.ts
import { Request, Response, NextFunction } from 'express';
import * as habitService from '../services/habit.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try { res.json(await habitService.listHabits(req.user!.sub)); } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try { res.status(201).json(await habitService.createHabit(req.user!.sub, req.body)); } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try { res.json(await habitService.updateHabit(req.user!.sub, req.params.id as string, req.body)); } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try { await habitService.deleteHabit(req.user!.sub, req.params.id as string); res.status(204).send(); } catch (err) { next(err); }
}

export async function toggle(req: Request, res: Response, next: NextFunction) {
  try { res.json(await habitService.toggleCompletion(req.user!.sub, req.params.id as string)); } catch (err) { next(err); }
}

export async function weekOverview(req: Request, res: Response, next: NextFunction) {
  try { res.json(await habitService.getWeekOverview(req.user!.sub)); } catch (err) { next(err); }
}

/** GET /habits/streak-status — habits whose streak broke recently */
export async function streakStatus(req: Request, res: Response, next: NextFunction) {
  try { res.json(await habitService.getBrokenStreaks(req.user!.sub)); } catch (err) { next(err); }
}