import { Request, Response, NextFunction } from 'express';
import { getGamificationProfile } from '../services/gamification.service';

export async function profile(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getGamificationProfile(req.user!.sub));
  } catch (err) {
    next(err);
  }
}
