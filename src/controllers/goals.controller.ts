import type { Request, Response, NextFunction } from 'express';
import * as goalService from '../services/goal.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await goalService.listGoals(req.user!.sub, req.query as any));
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await goalService.getGoal(req.user!.sub, req.params.id as string));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await goalService.createGoal(req.user!.sub, req.body));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await goalService.updateGoal(req.user!.sub, req.params.id as string, req.body));
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await goalService.deleteGoal(req.user!.sub, req.params.id as string, {
      deleteLinkedHabits: req.body?.deleteLinkedHabits === true,
      deleteLinkedTasks: req.body?.deleteLinkedTasks === true,
      deleteLinkedProjects: req.body?.deleteLinkedProjects === true,
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function listMilestones(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await goalService.listGoalMilestones(req.user!.sub, req.params.id as string));
  } catch (err) {
    next(err);
  }
}

export async function createMilestone(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await goalService.createGoalMilestone(req.user!.sub, req.params.id as string, req.body));
  } catch (err) {
    next(err);
  }
}

export async function updateMilestone(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await goalService.updateGoalMilestone(
        req.user!.sub,
        req.params.id as string,
        req.params.milestoneId as string,
        req.body
      )
    );
  } catch (err) {
    next(err);
  }
}

export async function deleteMilestone(req: Request, res: Response, next: NextFunction) {
  try {
    await goalService.deleteGoalMilestone(req.user!.sub, req.params.id as string, req.params.milestoneId as string);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
