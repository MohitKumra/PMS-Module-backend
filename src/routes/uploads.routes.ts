import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { createError } from '../middleware/errorHandler';
import { storeBase64File, deleteStoredFile } from '../lib/fileStorage';
import { applyStoredFile, removeStorageFile } from '../services/storage.service';
import { prisma } from '../lib/prismaClient';
import * as notesService from '../services/notes.service';

const router = Router();
router.use(authenticate);

const uploadSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  base64Data: z.string().min(1),
  folder: z.string().max(100).optional(),
});

/**
 * Cover upload schema.
 * The client performs the full processing pipeline (validate → resize →
 * WebP/JPEG → ~85% quality) before sending, so we receive an already-optimized
 * base64 payload. Max accepted size is 10 MB base64 (≈ 7.5 MB decoded).
 */
const coverUploadSchema = z.object({
  noteId: z.string().min(1),
  fileName: z.string().min(1).max(255),
  /** Must be webp or jpeg — the client converts everything to one of these */
  mimeType: z.enum(['image/webp', 'image/jpeg']),
  /** base64-encoded image data (data-URL prefix is stripped server-side) */
  base64Data: z.string().min(1).max(14_000_000), // ~10 MB base64
});

/** Resolve the authenticated user's email for per-user folder organisation. */
async function getUserEmail(userId: string): Promise<string | undefined> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return user?.email ?? undefined;
  } catch {
    return undefined;
  }
}

router.post('/upload', validate({ body: uploadSchema }), async (req, res, next) => {
  try {
    const userId = req.user!.sub;
    const userEmail = await getUserEmail(userId);
    const file = await storeBase64File({
      ...req.body,
      folder: req.body.folder ?? 'attachments',
      userId,
      userEmail,
    });
    await applyStoredFile(userId, file);
    res.status(201).json(file);
  } catch (error) {
    next(error);
  }
});

router.post('/upload-avatar', validate({ body: uploadSchema }), async (req, res, next) => {
  try {
    if (req.body.folder && req.body.folder !== 'attachments') {
      throw createError(400, 'INVALID_FOLDER', 'Avatar uploads cannot target voice folders');
    }
    const userId = req.user!.sub;
    const userEmail = await getUserEmail(userId);
    const file = await storeBase64File({
      ...req.body,
      folder: 'avatars',
      userId,
      userEmail,
    });
    await applyStoredFile(userId, file);
    res.status(201).json(file);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/media/upload-cover
 *
 * Upload a pre-processed book cover image and attach it to a note.
 *
 * Processing pipeline (client-side, before this endpoint receives the data):
 *   1. Validate format (JPEG / PNG / WebP / GIF / HEIC)
 *   2. Validate dimensions (min 100×100)
 *   3. Enforce max 10 MB raw file size
 *   4. Resize if width or height exceeds 1200 px (maintain aspect ratio)
 *   5. Convert to WebP (falling back to JPEG if WebP is unsupported)
 *   6. Compress at ~85% quality
 *
 * The server stores the optimized file, updates the note's coverUrl, and
 * returns the updated NoteDTO so the client stays in sync in one round-trip.
 */
router.post(
  '/upload-cover',
  validate({ body: coverUploadSchema }),
  async (req, res, next) => {
    try {
      const userId = req.user!.sub;
      const { noteId, fileName, mimeType, base64Data } = req.body as {
        noteId: string;
        fileName: string;
        mimeType: 'image/webp' | 'image/jpeg';
        base64Data: string;
      };

      // Verify the note belongs to this user
      const existing = await prisma.note.findFirst({ where: { id: noteId, userId } });
      if (!existing) {
        throw createError(404, 'NOTE_NOT_FOUND', 'Note not found');
      }

      const userEmail = await getUserEmail(userId);

      // Store the optimized cover on disk
      const stored = await storeBase64File({
        fileName,
        mimeType,
        base64Data,
        folder: 'note-covers',
        userId,
        userEmail,
      });

      // Remove the old cover file if one existed
      if (existing.coverUrl) {
        await deleteStoredFile(existing.coverUrl);
        await removeStorageFile(existing.coverUrl);
      }

      // Persist the new coverUrl (enforces storage and records usage)
      await applyStoredFile(userId, stored);
      const updated = await notesService.updateNote(userId, noteId, { coverUrl: stored.url });

      res.status(200).json(updated);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
