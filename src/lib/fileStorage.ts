import path from 'path';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import { env } from '../config/env';
import { createError } from '../middleware/errorHandler';

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export interface StoreFileInput {
  fileName: string;
  mimeType: string;
  base64Data: string;
  folder: 'avatars' | 'attachments' | 'voice-notes';
  userId?: string;
}

export interface StoredFile {
  fileName: string;
  mimeType: string;
  size: number;
  path: string;
  url: string;
}

function sanitizeBase64(input: string): string {
  return input.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
}

function safeExt(fileName: string, mimeType: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext && ext.length <= 10) return ext;

  switch (mimeType) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
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

export async function storeBase64File(input: StoreFileInput): Promise<StoredFile> {
  const cleanBase64 = sanitizeBase64(input.base64Data);
  const buffer = Buffer.from(cleanBase64, 'base64');

  if (buffer.length === 0) {
    throw createError(400, 'EMPTY_FILE', 'File upload is empty');
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw createError(400, 'FILE_TOO_LARGE', 'Files must be 4MB or smaller');
  }

  const ext = safeExt(input.fileName, input.mimeType);
  const userScope = input.userId ? path.join(input.folder, input.userId) : input.folder;
  const dir = path.join(UPLOAD_ROOT, userScope);
  await fs.mkdir(dir, { recursive: true });

  const slug = crypto.randomUUID();
  const safeBaseName = path.basename(input.fileName, path.extname(input.fileName)).replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'file';
  const storedName = `${Date.now()}-${safeBaseName}-${slug}${ext}`;
  const absolutePath = path.join(dir, storedName);
  await fs.writeFile(absolutePath, buffer);

  const publicPath = `/uploads/${userScope.replace(/\\/g, '/')}/${storedName}`;
  return {
    fileName: storedName,
    mimeType: input.mimeType,
    size: buffer.length,
    path: publicPath,
    url: `${env.BACKEND_URL}${publicPath}`,
  };
}

export async function deleteStoredFile(publicPath?: string | null): Promise<void> {
  if (!publicPath) return;
  
  // Handle both full URLs (http://localhost:3001/uploads/...) and relative paths (/uploads/...)
  let pathToDelete = publicPath;
  
  // If it's a full URL, extract just the path portion
  if (publicPath.startsWith('http://') || publicPath.startsWith('https://')) {
    try {
      const url = new URL(publicPath);
      pathToDelete = url.pathname;
    } catch (error) {
      return; // Invalid URL format
    }
  }
  
  if (!pathToDelete.startsWith('/uploads/')) return;

  const relative = pathToDelete.replace(/^\/uploads\//, '');
  const absolutePath = path.resolve(UPLOAD_ROOT, relative);
  
  if (!absolutePath.startsWith(UPLOAD_ROOT)) return; // Security check

  try {
    await fs.unlink(absolutePath);
  } catch {
    // Best-effort cleanup. Missing files should never block a write path.
  }
}
