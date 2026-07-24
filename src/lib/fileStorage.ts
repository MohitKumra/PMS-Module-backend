import { prisma } from './prismaClient';
import { createError } from '../middleware/errorHandler';

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

export interface StoreFileInput {
  fileName: string;
  mimeType: string;
  base64Data: string;
  folder: 'avatars' | 'attachments' | 'voice-notes';
  userId?: string;
}

export interface StoredFile {
  id: string;
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
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext && ext.length <= 10) return '.' + ext;

  switch (mimeType) {
    case 'image/jpeg':      return '.jpg';
    case 'image/png':       return '.png';
    case 'image/webp':      return '.webp';
    case 'image/gif':       return '.gif';
    case 'audio/webm':      return '.webm';
    case 'audio/ogg':       return '.ogg';
    case 'audio/mpeg':      return '.mp3';
    case 'audio/mp4':
    case 'audio/x-m4a':     return '.mp4';
    case 'application/pdf': return '.pdf';
    default:                return '';
  }
}

function safeBaseName(fileName: string): string {
  const name = fileName.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  return name || 'file';
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
  const baseName = safeBaseName(input.fileName);
  const storedName = `${Date.now()}-${baseName}${ext}`;

  const record = await prisma.uploadedFile.create({
    data: {
      userId: input.userId ?? 'anonymous',
      fileName: storedName,
      mimeType: input.mimeType,
      size: buffer.length,
      data: buffer,
      folder: input.folder,
    },
  });

  const publicPath = `/uploads/db/${record.id}/${storedName}`;
  return {
    id: record.id,
    fileName: storedName,
    mimeType: input.mimeType,
    size: buffer.length,
    path: publicPath,
    url: `${BACKEND_URL}/api/media/file/${record.id}/${encodeURIComponent(storedName)}`,
  };
}

export async function deleteStoredFile(publicPath?: string | null): Promise<void> {
  if (!publicPath) return;

  // Handle both old formats (full URLs with /uploads/) and new format (/api/media/file/:id)
  let fileId: string | null = null;

  if (publicPath.startsWith('http://') || publicPath.startsWith('https://')) {
    try {
      const url = new URL(publicPath);
      // New format: /api/media/file/:id
      const match = url.pathname.match(/^\/api\/media\/file\/([a-z0-9]+)/i);
      if (match) {
        fileId = match[1];
      }
    } catch {
      return; // Invalid URL
    }
  } else if (publicPath.startsWith('/api/media/file/')) {
    const match = publicPath.match(/^\/api\/media\/file\/([a-z0-9]+)/i);
    if (match) {
      fileId = match[1];
    }
  }

  if (!fileId) return;

  try {
    await prisma.uploadedFile.delete({ where: { id: fileId } });
  } catch {
    // Best-effort cleanup. Missing files should never block a write path.
  }
}

/** Fetch file data from database for serving */
export async function getFileById(fileId: string) {
  try {
    const file = await prisma.uploadedFile.findUnique({ where: { id: fileId } });
    return file;
  } catch {
    return null;
  }
}