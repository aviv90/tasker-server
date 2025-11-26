/**
 * Temporary File Utilities
 * 
 * Centralized functions for handling temporary files across the application.
 * Eliminates code duplication (DRY principle).
 */

import fs from 'fs';
import path from 'path';
import { FILE_SIZE, TIME } from './constants';
import { config } from '../config';

/**
 * Result of saving a buffer to a temporary file
 */
export interface TempFileResult {
  filePath: string;
  fileName: string;
  publicPath: string;
}

/**
 * Result of verifying a file was written
 */
export interface FileVerifyResult {
  success: boolean;
  size?: number;
  path?: string;
  error?: string;
}

/**
 * Get the temporary directory path
 * CRITICAL: Use config.paths.tmp to ensure consistency with static route
 * @returns Path to the temporary directory
 */
export function getTempDir(): string {
  // Use config.paths.tmp to ensure consistency with static route (which uses __dirname)
  return config.paths.tmp;
}

/**
 * Ensure the temporary directory exists
 * Creates it if it doesn't exist
 * @returns Path to the temporary directory
 */
export function ensureTempDir(): string {
  const tempDir = getTempDir();
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
    console.log(`📁 Created temp directory: ${tempDir}`);
  }
  return tempDir;
}

/**
 * Create a full path for a temporary file
 * @param filename - The filename (with or without extension)
 * @returns Full path to the temporary file
 */
export function createTempFilePath(filename: string): string {
  ensureTempDir();
  return path.join(getTempDir(), filename);
}

/**
 * Save a buffer to a temporary file
 * @param buffer - The buffer to save
 * @param filename - The filename
 * @returns Result with filePath and fileName
 */
export function saveBufferToTempFile(buffer: Buffer, filename: string): TempFileResult {
  const filePath = createTempFilePath(filename);
  fs.writeFileSync(filePath, buffer);
  console.log(`💾 Saved temp file: ${path.basename(filePath)} (${buffer.length} bytes)`);
  return {
    filePath,
    fileName: path.basename(filePath),
    publicPath: `/static/${path.basename(filePath)}`
  };
}

/**
 * Clean up a temporary file
 * @param filePath - Path to the file to delete
 * @returns True if deleted, false otherwise
 */
export function cleanupTempFile(filePath: string): boolean {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🧹 Cleaned up temporary file: ${path.basename(filePath)}`);
      return true;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn(`⚠️ Failed to cleanup file ${filePath}:`, errorMessage);
  }
  return false;
}

/**
 * Verify that a file was written correctly
 * @param filePath - Path to the file to verify
 * @param minSize - Minimum file size in bytes (default: FILE_SIZE.MIN_FILE_SIZE)
 * @param maxRetries - Maximum retry attempts (default: TIME.FILE_VERIFY_RETRIES)
 * @returns Promise with result containing success flag and stats
 */
export async function verifyFileWritten(
  filePath: string,
  minSize: number = FILE_SIZE.MIN_FILE_SIZE,
  maxRetries: number = TIME.FILE_VERIFY_RETRIES
): Promise<FileVerifyResult> {
  let retries = 0;
  let fileReady = false;

  while (!fileReady && retries < maxRetries) {
    await new Promise(resolve => setTimeout(resolve, 200));

    if (fs.existsSync(filePath)) {
      try {
        const stats = fs.statSync(filePath);

        if (stats.size > 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
          const newStats = fs.statSync(filePath);

          if (newStats.size === stats.size && stats.size >= minSize) {
            fileReady = true;
            return {
              success: true,
              size: stats.size,
              path: filePath
            };
          }
        }
      } catch (statError) {
        // Continue retrying
      }
    }
    retries++;
  }

  return {
    success: false,
    error: 'File was not written successfully'
  };
}

