/**
 * Green API File Handling Functions
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const STATIC_DIR = path.join(__dirname, '../..', 'public', 'tmp');

/**
 * Resolve local static file path from download URL
 */
function resolveLocalStaticPath(downloadUrl) {
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
async function downloadFile(downloadUrl, fileName = null) {
  try {
    if (!downloadUrl || typeof downloadUrl !== 'string') {
      throw new Error('Invalid download URL provided');
    }

    const localPath = resolveLocalStaticPath(downloadUrl);
    if (localPath && fs.existsSync(localPath)) {
      console.log(`📥 Loading file directly from local static path: ${localPath}`);
      const buffer = fs.readFileSync(localPath);
      console.log(`📥 File loaded locally: ${buffer.length} bytes`);

      if (fileName) {
        const filePath = path.join(STATIC_DIR, fileName);
        fs.writeFileSync(filePath, buffer);
        console.log(`📥 File also saved to: ${filePath}`);
      }

      return buffer;
    }

    console.log(`📥 Downloading file from URL (${downloadUrl.length} chars)`);

    const response = await axios.get(downloadUrl, {
      responseType: 'arraybuffer'
    });

    const buffer = Buffer.from(response.data);
    console.log(`📥 File downloaded as buffer: ${buffer.length} bytes`);

    // If fileName is provided, also save to file (for backward compatibility)
    if (fileName) {
      if (!fs.existsSync(STATIC_DIR)) {
        fs.mkdirSync(STATIC_DIR, { recursive: true });
      }

      const filePath = path.join(STATIC_DIR, fileName);
      fs.writeFileSync(filePath, buffer);
      console.log(`📥 File also saved to: ${filePath}`);
    }

    return buffer;
  } catch (error) {
    console.error('❌ Error downloading file:', error.message);
    throw error;
  }
}

module.exports = {
  resolveLocalStaticPath,
  downloadFile
};

