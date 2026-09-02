// backend/src/services/storage.service.ts
// Tracks per-user disk storage usage and enforces the plan storageMb limit.
import { prisma } from '../lib/prismaClient';
import { createError } from '../middleware/errorHandler';
import { resolveEffectivePlan } from './entitlement.service';
import { deleteStoredFile } from '../lib/fileStorage';

const MB = 1024 * 1024;

/** Decoded byte length of a base64 payload (data-URL prefix stripped). */
export function base64DecodedBytes(base64Data: string): number {
  const clean = base64Data.replace(/^data:[^,]*;base64,/,'').replace(/\s+/g,'');
  return Buffer.from(clean,'base64').length;
}

/** Sum of stored file bytes for a user. */
export async function getUserStorageUsedBytes(userId: string): Promise<number> {
  const agg = await prisma.userStorageFile.aggregate({
    where: { userId },
    _sum: { sizeBytes: true },
  });
  return agg._sum.sizeBytes ?? 0;
}

/** The user storage limit in bytes from the effective plan (Infinity if unlimited). */
export async function getUserStorageLimitBytes(userId: string): Promise<number> {
  const plan = await resolveEffectivePlan(userId);
  const mb = plan.features?.storageMb;
  if (typeof mb !== 'number' || mb === -1) return Infinity;
  return mb * MB;
}

/**
 * After a file has been stored to disk, enforce the plan storage limit and
 * record the row so future uploads count against it. If adding the new file
 * would exceed the limit, the file is deleted and a 403 PLAN_LIMIT_REACHED
 * is thrown so the caller can surface an upgrade modal.
 */
export async function applyStoredFile(userId: string, file: { url: string; size: number; path: string }): Promise<void> {
  const limit = await getUserStorageLimitBytes(userId);
  if (limit !== Infinity) {
    const used = await getUserStorageUsedBytes(userId);
    if (used + file.size > limit) {
      await deleteStoredFile(file.path);
      throw createError(403,'PLAN_LIMIT_REACHED', 'You have reached your storage limit. Please upgrade to unlock more storage.');
    }
  }
  const folder = (file.path.split('/')[3] ?? 'attachments');
  await recordStorageFile({ userId, url: file.url, sizeBytes: file.size, folder });
}

/** Record a stored file row (call after the file is written to disk). */
export async function recordStorageFile(data: { userId: string; url: string; sizeBytes: number; folder: string }): Promise<void> {
  await prisma.userStorageFile.upsert({
    where: { url: data.url },
    create: { userId: data.userId, url: data.url, sizeBytes: data.sizeBytes, folder: data.folder },
    update: { sizeBytes: data.sizeBytes, folder: data.folder },
  });
}

/** Remove a storage row by public URL (call after the file is deleted). */
export async function removeStorageFile(url: string): Promise<void> {
  if (!url) return;
  await prisma.userStorageFile.deleteMany({ where: { url } });
}

export type StorageFileType = 'image' | 'video' | 'audio' | 'document' | 'other';

export interface StorageFileDTO {
  id: string;
  url: string;
  name: string;
  sizeBytes: number;
  folder: string;
  fileType: StorageFileType;
  createdAt: string;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|svg|ico)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|avi|mkv|m4v)$/i;
const AUDIO_EXT = /\.(m4a|mp3|ogg|oga|wav|webm|aac|flac)$/i;
const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|json)$/i;

/** Derive a coarse file category from a public URL (extension-based). */
export function classifyFileType(url: string): StorageFileType {
  const path = url.split('?')[0];
  if (IMAGE_EXT.test(path)) return 'image';
  if (VIDEO_EXT.test(path)) return 'video';
  if (AUDIO_EXT.test(path)) return 'audio';
  if (DOC_EXT.test(path)) return 'document';
  return 'other';
}

/** Extract the file name from the trailing segment of a public URL. */
export function fileNameFromUrl(url: string): string {
  const path = url.split('?')[0];
  const seg = path.split('/').filter(Boolean).pop() ?? 'file';
  return decodeURIComponent(seg);
}

/** Map a storage sub-folder to a friendly label. */
export function folderLabel(folder: string): string {
  const map: Record<string, string> = {
    attachment: 'Attachments',
    attachments: 'Attachments',
    'task-attachment': 'Tasks',
    'project-attachment': 'Projects',
    'note-attachment': 'Notes',
    'goal-attachment': 'Goals',
    'ai-attachment': 'AI',
    avatar: 'Avatar',
    avatars: 'Avatar',
    'voice-note': 'Voice Notes',
    'voice-notes': 'Voice Notes',
    'note-covers': 'Notes',
  };
  return map[folder] ?? folder.charAt(0).toUpperCase() + folder.slice(1);
}

import fs from 'fs';
import path from 'path';

/** Automatically register existing files on disk for user if database rows are empty. */
export async function syncDiskStorageFiles(userId: string): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    const email = user?.email;
    const candidates = [
      email ? path.join(process.cwd(), 'uploads', email) : null,
      path.join(process.cwd(), 'uploads', userId),
      path.join(process.cwd(), 'uploads', 'finamite03@gmail.com'),
    ].filter(Boolean) as string[];

    for (const baseDir of candidates) {
      if (!fs.existsSync(baseDir)) continue;
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const folderName = ent.name;
        const folderPath = path.join(baseDir, folderName);
        const files = fs.readdirSync(folderPath);
        for (const file of files) {
          const filePath = path.join(folderPath, file);
          const stat = fs.statSync(filePath);
          if (stat.isFile()) {
            const relSub = path.basename(baseDir);
            const publicUrl = `/uploads/${relSub}/${folderName}/${file}`;
            await prisma.userStorageFile.upsert({
              where: { url: publicUrl },
              create: {
                userId,
                url: publicUrl,
                sizeBytes: stat.size,
                folder: folderName,
                createdAt: stat.birthtime || stat.mtime,
              },
              update: {
                sizeBytes: stat.size,
                folder: folderName,
              },
            });
          }
        }
      }
      break;
    }
  } catch (err) {
    // Non-blocking disk sync
  }
}

/** List a user's stored files with computed type/name, newest first. */
export async function getUserStorageFiles(userId: string): Promise<StorageFileDTO[]> {
  let rows = await prisma.userStorageFile.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  if (rows.length === 0) {
    await syncDiskStorageFiles(userId);
    rows = await prisma.userStorageFile.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    name: fileNameFromUrl(r.url),
    sizeBytes: r.sizeBytes,
    folder: r.folder,
    fileType: classifyFileType(r.url),
    createdAt: r.createdAt.toISOString(),
  }));
}


