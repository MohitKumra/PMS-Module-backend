import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import { deleteStoredFile, storeBase64File } from '../lib/fileStorage';

export async function updateProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const { name } = req.body ?? {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw createError(400, 'INVALID_NAME', 'Name is required');
    }

    const updated = await prisma.user.update({
      where: { id: req.user!.sub },
      data: { name: name.trim() },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        recoveryEmail: true,
        timezone: true,
        passwordHash: true,
        googleId: true,
        createdAt: true,
      },
    });

    res.json({
      id: updated.id,
      email: updated.email,
      name: updated.name,
      avatarUrl: updated.avatarUrl,
      recoveryEmail: updated.recoveryEmail,
      timezone: updated.timezone,
      hasPassword: Boolean(updated.passwordHash),
      hasGoogle: Boolean(updated.googleId),
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
}

export async function updateAvatar(req: Request, res: Response, next: NextFunction) {
  try {
    const { fileName, mimeType, base64Data } = req.body ?? {};
    if (!fileName || !mimeType || !base64Data) {
      throw createError(400, 'INVALID_AVATAR_UPLOAD', 'Avatar file data is required');
    }

    const existing = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!existing) throw createError(404, 'USER_NOT_FOUND', 'User not found');

    const uploaded = await storeBase64File({
      fileName,
      mimeType,
      base64Data,
      folder: 'avatars',
      userId: req.user!.sub,
    });

    const updated = await prisma.user.update({
      where: { id: req.user!.sub },
      data: { avatarUrl: uploaded.url },
    });

    await deleteStoredFile(existing.avatarUrl);
    res.json({ avatarUrl: updated.avatarUrl });
  } catch (error) {
    next(error);
  }
}

export async function removeAvatar(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!existing) throw createError(404, 'USER_NOT_FOUND', 'User not found');

    await prisma.user.update({
      where: { id: req.user!.sub },
      data: { avatarUrl: null },
    });
    await deleteStoredFile(existing.avatarUrl);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
