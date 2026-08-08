// backend/src/controllers/focus.controller.ts
import type { Request, Response, NextFunction } from 'express';
import * as focusService from '../services/focus.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await focusService.listSessions(req.user!.sub));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await focusService.createSession(req.user!.sub, req.body));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await focusService.updateSession(req.user!.sub, req.params.id as string, req.body));
  } catch (err) {
    next(err);
  }
}

export async function complete(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await focusService.completeSession(req.user!.sub, req.params.id as string));
  } catch (err) {
    next(err);
  }
}

export async function cancel(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await focusService.cancelSession(req.user!.sub, req.params.id as string));
  } catch (err) {
    next(err);
  }
}

export async function getActive(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await focusService.getActiveSession(req.user!.sub);
    if (!session) {
      res.status(204).send();
      return;
    }
    res.json(session);
  } catch (err) {
    next(err);
  }
}

export async function logTime(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await focusService.logTime(req.user!.sub, req.body));
  } catch (err) {
    next(err);
  }
}

export async function listTimeLogs(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await focusService.listTimeLogs(req.user!.sub));
  } catch (err) {
    next(err);
  }
}
