import type { Request, Response, NextFunction } from 'express';
import * as habitService from '../services/habit.service';
import { prisma } from '../lib/prismaClient';
import { checkUserEntitlement } from '../services/entitlement.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await habitService.listHabits(req.user!.sub, req.query as any));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.sub;
    const currentCount = await prisma.habit.count({ where: { userId } });
    const entitlement = await checkUserEntitlement(userId, 'habits', currentCount + 1);
    if (!entitlement.allowed) {
      return res.status(403).json({
        error: {
          code: 'PLAN_LIMIT_REACHED',
          message: `Your current plan (${entitlement.currentEffectivePlan}) allows up to ${entitlement.limit} habits. Please upgrade to track more habits.`,
          currentEffectivePlan: entitlement.currentEffectivePlan,
          limit: entitlement.limit,
        },
      });
    }

    res.status(201).json(await habitService.createHabit(userId, req.body));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await habitService.updateHabit(req.user!.sub, req.params.id as string, req.body));
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await habitService.deleteHabit(req.user!.sub, req.params.id as string);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function toggle(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await habitService.toggleCompletion(req.user!.sub, req.params.id as string));
  } catch (err) {
    next(err);
  }
}

export async function weekOverview(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await habitService.getWeekOverview(req.user!.sub));
  } catch (err) {
    next(err);
  }
}

/** GET /habits/streak-status — habits whose streak broke recently */
export async function streakStatus(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await habitService.getBrokenStreaks(req.user!.sub));
  } catch (err) {
    next(err);
  }
}
