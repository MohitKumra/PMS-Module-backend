// backend/src/controllers/notes.controller.ts
import type { Request, Response, NextFunction } from 'express';
import * as notesService from '../services/notes.service';
import type { NoteListFilters } from '../types';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const filters: NoteListFilters = {
      isJournal: req.query.isJournal !== undefined ? req.query.isJournal === 'true' : undefined,
      taskId: typeof req.query.taskId === 'string' ? req.query.taskId : undefined,
      projectId: typeof req.query.projectId === 'string' ? req.query.projectId : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      tags: typeof req.query.tags === 'string' ? req.query.tags.split(',') : undefined,
      mood: typeof req.query.mood === 'string' ? (req.query.mood as NoteListFilters['mood']) : undefined,
      dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
      dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
      archived: req.query.archived !== undefined ? req.query.archived === 'true' : undefined,
      isPinned: req.query.isPinned !== undefined ? req.query.isPinned === 'true' : undefined,
      sortField:
        typeof req.query.sortField === 'string' ? (req.query.sortField as NoteListFilters['sortField']) : undefined,
      sortOrder:
        typeof req.query.sortOrder === 'string' ? (req.query.sortOrder as NoteListFilters['sortOrder']) : undefined,
      page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    };
    res.json(await notesService.listNotes(req.user!.sub, filters));
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await notesService.getNote(req.user!.sub, req.params.id as string));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await notesService.createNote(req.user!.sub, req.body));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await notesService.updateNote(req.user!.sub, req.params.id as string, req.body));
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await notesService.deleteNote(req.user!.sub, req.params.id as string);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
