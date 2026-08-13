import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { createError } from '../middleware/errorHandler';
import { storeBase64File } from '../lib/fileStorage';
import { prisma } from '../lib/prismaClient';

const router = Router();
router.use(authenticate);

const uploadSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  base64Data: z.string().min(1),
  folder: z.enum(['attachments', 'voice-notes']).optional(),
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
    res.status(201).json(file);
  } catch (error) {
    next(error);
  }
});

export default router;
