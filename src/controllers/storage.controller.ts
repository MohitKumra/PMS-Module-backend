// backend/src/controllers/storage.controller.ts
// GET /api/storage — lists the authenticated user's stored files with a
// per-type / per-folder summary so the Storage page can render stats + filters.
import { Request, Response, NextFunction } from 'express';
import {
  getUserStorageFiles,
  getUserStorageUsedBytes,
  getUserStorageLimitBytes,
  StorageFileType,
} from '../services/storage.service';

export async function listStorageFiles(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.sub || (req.user as any)!.id;
    const [files, totalBytes, storageLimitBytes] = await Promise.all([
      getUserStorageFiles(userId),
      getUserStorageUsedBytes(userId),
      getUserStorageLimitBytes(userId),
    ]);

    const byType: Record<StorageFileType, { count: number; bytes: number }> = {
      image: { count: 0, bytes: 0 },
      video: { count: 0, bytes: 0 },
      audio: { count: 0, bytes: 0 },
      document: { count: 0, bytes: 0 },
      other: { count: 0, bytes: 0 },
    };
    const byFolder: Record<string, { count: number; bytes: number }> = {};

    for (const f of files) {
      byType[f.fileType].count += 1;
      byType[f.fileType].bytes += f.sizeBytes;
      if (!byFolder[f.folder]) byFolder[f.folder] = { count: 0, bytes: 0 };
      byFolder[f.folder].count += 1;
      byFolder[f.folder].bytes += f.sizeBytes;
    }

    return res.json({
      data: {
        files,
        summary: {
          totalBytes: totalBytes ?? 0,
          storageLimitBytes: Number.isFinite(storageLimitBytes) ? storageLimitBytes : null,
          byType,
          byFolder,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}
