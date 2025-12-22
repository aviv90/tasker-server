/**
 * Green API File Handling Functions
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import logger from '../../utils/logger';
import { getTempDir } from '../../utils/tempFileUtils';
import { GREEN_API_API_TOKEN_INSTANCE } from './constants';

// Use centralized temp directory (SSOT with static route)
const STATIC_DIR = getTempDir();

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

  // Case 3: Bare filename or relative path (e.g. from history or cache)
  if (!downloadUrl.match(/^https?:\/\//)) {
    // Try exact match in STATIC_DIR
    const cleanName = path.basename(downloadUrl);
    const putativePath = path.join(STATIC_DIR, cleanName);
    if (fs.existsSync(putativePath)) {
      return putativePath;
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

    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await axios.get(downloadUrl, {
          responseType: 'arraybuffer',
          timeout: 30000,
          headers: downloadUrl.includes('green-api.com') ? {
            'Authorization': `Bearer ${GREEN_API_API_TOKEN_INSTANCE}`, // Try Bearer
            'api-token': GREEN_API_API_TOKEN_INSTANCE // Try custom header
          } : {}
        });
        const buffer = Buffer.from(response.data);
        logger.info(`📥 File downloaded as buffer: ${buffer.length} bytes (attempt ${attempt})`, { fileName, size: buffer.length });

        // If fileName is provided... (existing logic)
        if (fileName) {
          if (!fs.existsSync(STATIC_DIR)) {
            fs.mkdirSync(STATIC_DIR, { recursive: true });
          }
          const filePath = path.join(STATIC_DIR, fileName);
          fs.writeFileSync(filePath, buffer);
          logger.info(`📥 File also saved to: ${filePath}`, { fileName, filePath });
        }

        return buffer;
      } catch (err) {
        lastError = err;
        logger.warn(`⚠️ Download attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`);
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    throw lastError;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Error downloading file:', { error: errorMessage, fileName, downloadUrl: downloadUrl?.substring(0, 100) });
    throw error;
  }
}

