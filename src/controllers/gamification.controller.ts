import { Request, Response, NextFunction } from 'express';
import { getGamificationProfile, getAchievementsWithStatus } from '../services/gamification.service';

export async function profile(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getGamificationProfile(req.user!.sub));
  } catch (err) {
    next(err);
  }
}

export async function achievements(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getAchievementsWithStatus(req.user!.sub));
  } catch (err) {
    next(err);
  }
}