// backend/src/controllers/search.controller.ts
// Search controller

import type { Request, Response, NextFunction } from 'express';
import { search } from '../services/search.service';

export async function searchHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.sub;
    const query = req.query.q as string;

    if (!query || query.trim().length === 0) {
      return res.status(200).json({ data: [] });
    }

    const results = await search(userId, query.trim());
    res.status(200).json({ data: results });
  } catch (error) {
    next(error);
  }
}
