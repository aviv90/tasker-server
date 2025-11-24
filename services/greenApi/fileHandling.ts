/**
 * Green API File Handling Functions
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import logger from '../../utils/logger';

const STATIC_DIR = path.join(__dirname, '../..', 'public', 'tmp');

/**
 * Resolve local static file path from download URL
 */
export function resolveLocalStaticPath(downloadUrl: string | null | undefined): string | null {
  if (!downloadUrl || typeof downloadUrl !== 'string') {
    return null;
  }

  const STATIC_PREFIX = '/static/';

  try {
    if (downloadUrl.startsWith(STATIC_PREFIX)) {
      return path.join(STATIC_DIR, downloadUrl.slice(STATIC_PREFIX.length));
    }

    const parsed = new URL(downloadUrl);
    if (parsed.pathname && parsed.pathname.startsWith(STATIC_PREFIX)) {
      return path.join(STATIC_DIR, parsed.pathname.slice(STATIC_PREFIX.length));
    }
  } catch (parseError) {
    // If URL constructor fails (e.g., missing scheme), fallback to substring detection
    const index = downloadUrl.indexOf(STATIC_PREFIX);
    if (index !== -1) {
      return path.join(STATIC_DIR, downloadUrl.slice(index + STATIC_PREFIX.length));
    }
  }

  return null;
}

/**
 * Download file from WhatsApp message and return as Buffer
 */
export async function downloadFile(downloadUrl: string, fileName: string | null = null): Promise<Buffer> {
  try {
    if (!downloadUrl || typeof downloadUrl !== 'string') {
      throw new Error('Invalid download URL provided');
    }

    const localPath = resolveLocalStaticPath(downloadUrl);
    if (localPath && fs.existsSync(localPath)) {
      logger.info(`📥 Loading file directly from local static path: ${localPath}`, { fileName });
      const buffer = fs.readFileSync(localPath);
      logger.info(`📥 File loaded locally: ${buffer.length} bytes`, { fileName, size: buffer.length });

      if (fileName) {
        const filePath = path.join(STATIC_DIR, fileName);
        fs.writeFileSync(filePath, buffer);
        logger.info(`📥 File also saved to: ${filePath}`, { fileName, filePath });
      }

      return buffer;
    }

    logger.info(`📥 Downloading file from URL (${downloadUrl.length} chars)`, { fileName, urlLength: downloadUrl.length });

    const response = await axios.get(downloadUrl, {
      responseType: 'arraybuffer'
    });

    const buffer = Buffer.from(response.data);
    logger.info(`📥 File downloaded as buffer: ${buffer.length} bytes`, { fileName, size: buffer.length });

    // If fileName is provided, also save to file (for backward compatibility)
    if (fileName) {
      if (!fs.existsSync(STATIC_DIR)) {
        fs.mkdirSync(STATIC_DIR, { recursive: true });
      }

      const filePath = path.join(STATIC_DIR, fileName);
      fs.writeFileSync(filePath, buffer);
      logger.info(`📥 File also saved to: ${filePath}`, { fileName, filePath });
    }

    return buffer;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Error downloading file:', { error: errorMessage, fileName, downloadUrl: downloadUrl?.substring(0, 100) });
    throw error;
  }
}

