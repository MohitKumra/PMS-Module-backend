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

// Subtask controllers
export async function listSubTasks(req: Request, res: Response, next: NextFunction) {
  try {
    const subTasks = await taskService.listSubTasks(req.user!.sub, req.params.taskId as string);
    res.json(subTasks);
  } catch (err) { next(err); }
}

export async function createSubTask(req: Request, res: Response, next: NextFunction) {
  try {
    const subTask = await taskService.createSubTask(req.user!.sub, req.params.taskId as string, req.body);
    res.status(201).json(subTask);
  } catch (err) { next(err); }
}

export async function updateSubTask(req: Request, res: Response, next: NextFunction) {
  try {
    const subTask = await taskService.updateSubTask(
      req.user!.sub, 
      req.params.taskId as string, 
      req.params.subTaskId as string, 
      req.body
    );
    res.json(subTask);
  } catch (err) { next(err); }
}

export async function deleteSubTask(req: Request, res: Response, next: NextFunction) {
  try {
    await taskService.deleteSubTask(
      req.user!.sub, 
      req.params.taskId as string, 
      req.params.subTaskId as string
    );
    res.status(204).send();
  } catch (err) { next(err); }
}

export async function createTimeEntry(req: Request, res: Response, next: NextFunction) {
  try {
    const entry = await taskService.createTaskTimeEntry(req.user!.sub, req.params.taskId as string, req.body);
    res.status(201).json(entry);
  } catch (err) { next(err); }
}
