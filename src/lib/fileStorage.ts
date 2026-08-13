// backend/src/lib/fileStorage.ts
// Stores uploaded files on disk under uploads/<email>/<folder>.
// Files live purely on the server filesystem - they are NOT stored in Postgres.
// These are served by the express.static('/uploads', ...) mount in server.ts.
//
// Public URL pattern:  <BACKEND_URL>/uploads/<email>/<folder>/<storedName>
// Example:  http://localhost:3001/uploads/test@gmail.com/task-attachment/178...-report.png

import fs from 'fs';
import path from 'path';
import { prisma } from './prismaClient';
import { createError } from '../middleware/errorHandler';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB
const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:3001').replace(/\/$/, '');

// Root of the uploads directory - relative to the cwd of the running process.
const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads');

// Sub-folders used inside each user's email folder so data is organised and
// separated per user + type (e.g. uploads/<email>/task-attachment/...).
export const UPLOAD_FOLDER_TYPES = [
  'avatar',
  'task-attachment',
  'project-attachment',
  'note-attachment',
  'ai-attachment',
  'goal-attachment',
  'voice-note',
] as const;

export interface StoreFileInput {
  fileName: string;
  mimeType: string;
  base64Data: string;
  /** Destination sub-folder under the user's email folder (e.g. 'avatars', 'attachments'). */
  folder: string;
  userId?: string;
  userEmail?: string;
}

export interface StoredFile {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  path: string;
  url: string;
}

/** Strip a data-URL prefix and any whitespace so the base64 payload is clean. */
function sanitizeBase64(input: string): string {
  return input.replace(/^data:[^,]*;base64,/, '').replace(/\s+/g, '');
}

/** Derive a safe, browser-friendly file extension from the source name / mime type. */
function safeExt(fileName: string, mimeType: string): string {
  // Audio MP4 should always use .m4a - browsers reject .mp4 for audio.
  if (mimeType === 'audio/mp4' || mimeType === 'audio/x-m4a') {
    return '.m4a';
  }

  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext && ext.length <= 10) return '.' + ext;

  switch (mimeType) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    case 'image/avif':
      return '.avif';
    case 'audio/webm':
      return '.webm';
    case 'audio/ogg':
      return '.ogg';
    case 'audio/mpeg':
      return '.mp3';
    case 'application/pdf':
      return '.pdf';
    default:
      return '';
  }
}

/** Sanitize a base file name into a safe, url-friendly token. */
function safeBaseName(fileName: string): string {
  const name = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .toLowerCase();
  return name || 'file';
}

/**
 * Sanitize the per-user owner segment (email preferred, falls back to userId).
 * Keeps only characters that are safe in URLs and filesystem paths.
 */
function safeOwnerSegment(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9@._-]+/g, '-').replace(/^\.+|\.+$/g, '').toLowerCase();
  return cleaned || 'user';
}

/** Sanitize the destination folder segment (e.g. 'task-attachment'). */
function safeFolderSegment(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'attachments';
}

/**
 * Store an uploaded (base64) file on disk.
 * Layout: uploads/<email|userId>/<folder>/<storedName>
 */
export async function storeBase64File(input: StoreFileInput): Promise<StoredFile> {
  const cleanBase64 = sanitizeBase64(input.base64Data);
  const buffer = Buffer.from(cleanBase64, 'base64');

  if (buffer.length === 0) {
    throw createError(400, 'EMPTY_FILE', 'File upload is empty');
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw createError(400, 'FILE_TOO_LARGE', 'Files must be 8MB or smaller');
  }

  const ext = safeExt(input.fileName, input.mimeType);
  const baseName = safeBaseName(input.fileName);
  const storedName = `${Date.now()}-${baseName}${ext}`;

  const owner = safeOwnerSegment(input.userEmail?.trim() || input.userId?.trim() || 'anonymous');
  const folder = safeFolderSegment(input.folder);

  const dir = path.join(UPLOADS_ROOT, owner, folder);
  fs.mkdirSync(dir, { recursive: true });
  const absolutePath = path.join(dir, storedName);
  fs.writeFileSync(absolutePath, buffer);

  const publicPath = `/uploads/${owner}/${folder}/${storedName}`;
  return {
    id: storedName,
    fileName: storedName,
    mimeType: input.mimeType,
    size: buffer.length,
    path: publicPath,
    url: `${BACKEND_URL}${publicPath}`,
  };
}

/**
 * Delete a stored file by its public URL or relative path.
 * Handles full URLs (http://...) and relative paths (/uploads/...) and is
 * best-effort: it never throws on a write path.
 */
export async function deleteStoredFile(publicPath?: string | null): Promise<void> {
  if (!publicPath) return;

  let relativePath = publicPath;
  if (publicPath.startsWith('http://') || publicPath.startsWith('https://')) {
    try {
      relativePath = new URL(publicPath).pathname;
    } catch {
      return; // Invalid URL - nothing to delete
    }
  }

  if (!relativePath.startsWith('/uploads/')) return;

  const resolved = path.resolve(UPLOADS_ROOT, relativePath.replace(/^\/uploads\//, ''));

  // Security: never allow deletion outside the uploads directory (path traversal guard).
  if (resolved !== UPLOADS_ROOT && !resolved.startsWith(UPLOADS_ROOT + path.sep)) return;

  try {
    fs.unlinkSync(resolved);
  } catch {
    // Best-effort cleanup - a missing file should never block a write path.
  }
}

/**
 * Fetch a legacy uploaded file from the database.
 * Only used by /api/media/file/:id for files stored before the disk-based
 * uploads were introduced. New uploads live on disk under /uploads.
 */
export async function getFileById(fileId: string) {
  try {
    const file = await prisma.uploadedFile.findUnique({ where: { id: fileId } });
    return file;
  } catch {
    return null;
  }
}
