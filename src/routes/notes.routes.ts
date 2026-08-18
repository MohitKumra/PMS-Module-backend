// backend/src/routes/notes.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../controllers/notes.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';

const router = Router();
router.use(authenticate);

// Bookmark schema for multi-bookmark system
const bookmarkSchema = z.object({
  id: z.string(),
  pageNumber: z.number().int().min(1),
  color: z.enum(['yellow', 'red', 'blue', 'green', 'purple']),
  label: z.string().max(100).optional(),
  createdAt: z.string().datetime(),
});

const createSchema = z.object({
  title: z.string().max(500).optional(),
  content: z.string().min(1),
  isJournal: z.boolean().optional(),
  taskId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  attachmentUrl: z
    .string()
    .max(2048)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v)),
  voiceNoteUrl: z
    .string()
    .max(2048)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v)),
  mood: z.enum(['great', 'good', 'neutral', 'bad', 'awful']).nullable().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  isPinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  bookmarkPage: z.number().nullable().optional(), // Legacy single bookmark
  bookmarks: z.array(bookmarkSchema).max(5).optional(), // Multi-bookmark system (max 5)
  contentVersion: z.number().int().min(1).optional(),
});
const idParams = z.object({ id: z.string() });

router.get('/', ctrl.list);
router.get('/:id', validate({ params: idParams }), ctrl.getOne);
router.post('/', validate({ body: createSchema }), ctrl.create);
router.patch('/:id', validate({ params: idParams, body: createSchema.partial() }), ctrl.update);
router.delete('/:id', validate({ params: idParams }), ctrl.remove);

export default router;
