import { Router } from 'express';
import { getFileById } from '../lib/fileStorage';

const router = Router();

/**
 * Strip codecs/parameters from Content-Type (e.g. "audio/webm;codecs=opus" -> "audio/webm")
 * Some browsers reject audio with codecs params in the Content-Type header.
 */
function cleanMimeType(mimeType: string): string {
  return mimeType.split(';')[0].trim();
}

/**
 * GET /api/media/file/:id/:filename
 * GET /api/media/file/:id
 * Serves an uploaded file from the database with correct headers.
 * The :filename param is cosmetic — it helps the frontend detect file type
 * (image vs audio) and display a meaningful name.
 * Supports Range requests for audio/video seeking.
 */
async function serveFile(req: any, res: any) {
  try {
    const { id } = req.params;
    const file = await getFileById(id);

    if (!file) {
      console.error('[MediaFile] File not found in DB:', id);
      res.status(404).json({ error: { code: 'FILE_NOT_FOUND', message: 'File not found' } });
      return;
    }

    const fileBuffer = file.data;
    const fileSize = fileBuffer.length;
    const mimeType = cleanMimeType(file.mimeType);

    console.log(`[MediaFile] Serving file ${id}: ${file.fileName} (${mimeType}, ${fileSize} bytes)`);

    // Handle Range requests (for audio seeking)
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;

      if (start >= fileSize || end >= fileSize) {
        res.status(416).set({
          'Content-Range': `bytes */${fileSize}`,
        }).end();
        return;
      }

      res.status(206).set({
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize.toString(),
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000',
        'Access-Control-Allow-Origin': '*',
      });

      res.end(fileBuffer.subarray(start, end + 1));
      return;
    }

    // Full file response
    res.set({
      'Content-Type': mimeType,
      'Content-Length': fileSize.toString(),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000',
      'Access-Control-Allow-Origin': '*',
      'Content-Disposition': `inline; filename="${file.fileName}"`,
    });

    res.end(fileBuffer);
  } catch (error) {
    console.error('[MediaFile] Error serving file:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to serve file' } });
  }
}

router.get('/file/:id/:filename', serveFile);
router.get('/file/:id', serveFile);

export default router;