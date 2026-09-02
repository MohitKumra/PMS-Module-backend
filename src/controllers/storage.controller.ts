// backend/src/controllers/storage.controller.ts
// GET /api/storage — lists the authenticated user's stored files with a
// per-type / per-folder summary so the Storage page can render stats + filters.
// Filtering, sorting and pagination are ALL done server-side; the frontend only
// asks for a page and renders whatever comes back.
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prismaClient';
import { deleteStoredFile } from '../lib/fileStorage';
import {
  getUserStorageFiles,
  getUserStorageUsedBytes,
  getUserStorageLimitBytes,
  filterAndSortStorageFiles,
  StorageFileType,
  StorageQuickTab,
} from '../services/storage.service';

const MB = 1024 * 1024;

export async function listStorageFiles(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.sub || (req.user as any)!.id;

    // ── Server-side query params (filters + sort + pagination) ──────────────
    const tab     = ((req.query.tab as string) || 'all') as StorageQuickTab;
    const type    = ((req.query.type as string) || 'all') as StorageFileType | 'all';
    const folder  = (req.query.folder as string) || 'all';
    const search  = (req.query.search as string) || '';
    const sortBy  = (req.query.sortBy as string) || 'newest';
    const page    = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string, 10) || 8));

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

    const largeFileCount = files.filter((f) => f.sizeBytes >= MB).length;

    // Filter + sort the full set, then slice the requested offset page.
    const filtered = filterAndSortStorageFiles(files, { tab, type, folder, search, sortBy });
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const pageFiles = filtered.slice((page - 1) * pageSize, page * pageSize);

    return res.json({
      data: {
        files: pageFiles,
        summary: {
          totalBytes: totalBytes ?? 0,
          storageLimitBytes: Number.isFinite(storageLimitBytes) ? storageLimitBytes : null,
          byType,
          byFolder,
          largeFileCount,
          fileIds: files.map((f) => f.id),
        },
        pagination: {
          total,
          page,
          pageSize,
          totalPages,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteStorageFile(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = String(req.user!.sub || (req.user as any)!.id);
    const fileId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const file = await prisma.userStorageFile.findFirst({
      where: { id: fileId, userId },
    });
    if (!file) {
      return res.status(404).json({ error: { message: 'File not found' } });
    }
    await deleteStoredFile(file.url);
    await prisma.userStorageFile.deleteMany({ where: { id: fileId, userId } });
    return res.json({ success: true, message: 'File deleted successfully' });
  } catch (err) {
    next(err);
  }
}

export async function batchDeleteStorageFiles(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = String(req.user!.sub || (req.user as any)!.id);
    const { ids } = req.body as { ids?: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: { message: 'No file IDs provided' } });
    }
    const cleanIds = ids.map(String);
    const files = await prisma.userStorageFile.findMany({
      where: { id: { in: cleanIds }, userId },
    });
    for (const f of files) {
      await deleteStoredFile(f.url);
    }
    await prisma.userStorageFile.deleteMany({
      where: { id: { in: cleanIds }, userId },
    });
    return res.json({ success: true, count: files.length });
  } catch (err) {
    next(err);
  }
}


