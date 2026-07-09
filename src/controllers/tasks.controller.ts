// backend/src/controllers/tasks.controller.ts
import { Request, Response, NextFunction } from 'express';
import * as taskService from '../services/task.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await taskService.listTasks(req.user!.sub, req.query as Record<string, string>);
    res.json(result);
  } catch (err) { next(err); }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await taskService.getTask(req.user!.sub, req.params.id as string);
    res.json(task);
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await taskService.createTask(req.user!.sub, req.body);
    res.status(201).json(task);
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await taskService.updateTask(req.user!.sub, req.params.id as string, req.body);
    res.json(task);
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await taskService.deleteTask(req.user!.sub, req.params.id as string);
    res.status(204).send();
  } catch (err) { next(err); }
}
