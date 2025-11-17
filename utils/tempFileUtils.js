/**
 * Temporary File Utilities
 * 
 * Centralized functions for handling temporary files across the application.
 * Eliminates code duplication (DRY principle).
 */

const fs = require('fs');
const path = require('path');

/**
 * Get the temporary directory path
 * @returns {string} Path to the temporary directory
 */
function getTempDir() {
  return path.join(__dirname, '..', 'public', 'tmp');
}

/**
 * Ensure the temporary directory exists
 * Creates it if it doesn't exist
 * @returns {string} Path to the temporary directory
 */
function ensureTempDir() {
  const tempDir = getTempDir();
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
    console.log(`📁 Created temp directory: ${tempDir}`);
  }
  return tempDir;
}

/**
 * Create a full path for a temporary file
 * @param {string} filename - The filename (with or without extension)
 * @returns {string} Full path to the temporary file
 */
function createTempFilePath(filename) {
  ensureTempDir();
  return path.join(getTempDir(), filename);
}

/**
 * Save a buffer to a temporary file
 * @param {Buffer} buffer - The buffer to save
 * @param {string} filename - The filename
 * @returns {Object} Result with filePath and fileName
 */
function saveBufferToTempFile(buffer, filename) {
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
 * @param {string} filePath - Path to the file to delete
 * @returns {boolean} True if deleted, false otherwise
 */
function cleanupTempFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🧹 Cleaned up temporary file: ${path.basename(filePath)}`);
      return true;
    }
  } catch (err) {
    console.warn(`⚠️ Failed to cleanup file ${filePath}:`, err.message);
  }
  return false;
}

/**
 * Verify that a file was written correctly
 * @param {string} filePath - Path to the file to verify
 * @param {number} minSize - Minimum file size in bytes (default: 1000)
 * @param {number} maxRetries - Maximum retry attempts (default: 15)
 * @returns {Promise<Object>} Result with success flag and stats
 */
async function verifyFileWritten(filePath, minSize = 1000, maxRetries = 15) {
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

module.exports = {
  getTempDir,
  ensureTempDir,
  createTempFilePath,
  saveBufferToTempFile,
  cleanupTempFile,
  verifyFileWritten
};

