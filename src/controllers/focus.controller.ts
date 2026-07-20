// backend/src/controllers/focus.controller.ts
import { Request, Response, NextFunction } from 'express';
import * as focusService from '../services/focus.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try { res.json(await focusService.listSessions(req.user!.sub)); } catch (err) { next(err); }
}

export async function log(req: Request, res: Response, next: NextFunction) {
  try { res.status(201).json(await focusService.logSession(req.user!.sub, req.body)); } catch (err) { next(err); }
}

export async function logTime(req: Request, res: Response, next: NextFunction) {
  try { res.status(201).json(await focusService.logTime(req.user!.sub, req.body)); } catch (err) { next(err); }
}

export async function listTimeLogs(req: Request, res: Response, next: NextFunction) {
  try { res.json(await focusService.listTimeLogs(req.user!.sub)); } catch (err) { next(err); }
}