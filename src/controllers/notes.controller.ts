// backend/src/controllers/notes.controller.ts
import { Request, Response, NextFunction } from 'express';
import * as notesService from '../services/notes.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const isJournal = req.query.isJournal !== undefined ? req.query.isJournal === 'true' : undefined;
    res.json(await notesService.listNotes(req.user!.sub, isJournal));
  } catch (err) { next(err); }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try { res.json(await notesService.getNote(req.user!.sub, req.params.id as string)); } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try { res.status(201).json(await notesService.createNote(req.user!.sub, req.body)); } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try { res.json(await notesService.updateNote(req.user!.sub, req.params.id as string, req.body)); } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try { await notesService.deleteNote(req.user!.sub, req.params.id as string); res.status(204).send(); } catch (err) { next(err); }
}
