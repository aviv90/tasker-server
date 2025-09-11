const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * Green API WhatsApp Service
 * Handles sending messages and files via Green API
 */

const GREEN_API_URL = process.env.GREEN_API_URL || 'https://api.green-api.com';
const GREEN_API_ID_INSTANCE = process.env.GREEN_API_ID_INSTANCE || 'your_instance_id';
const GREEN_API_API_TOKEN_INSTANCE = process.env.GREEN_API_API_TOKEN_INSTANCE || 'your_api_token';

/**
 * Send text message via Green API
 */
async function sendTextMessage(chatId, message) {
  try {
    const url = `${GREEN_API_URL}/waInstance${GREEN_API_ID_INSTANCE}/sendMessage/${GREEN_API_API_TOKEN_INSTANCE}`;
    
    const data = {
      chatId: chatId,
      message: message
    };

    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log(`📤 Message sent to ${chatId}:`, message.substring(0, 50) + '...');
    return response.data;
  } catch (error) {
    console.error('❌ Error sending text message:', error.message);
    throw error;
  }
}

/**
 * Send file by URL via Green API
 */
async function sendFileByUrl(chatId, fileUrl, fileName, caption = '') {
  try {
    const url = `${GREEN_API_URL}/waInstance${GREEN_API_ID_INSTANCE}/sendFileByUrl/${GREEN_API_API_TOKEN_INSTANCE}`;
    
    const data = {
      chatId: chatId,
      urlFile: fileUrl,
      fileName: fileName,
      caption: caption
    };

    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log(`📤 File sent to ${chatId}: ${fileName}`);
    return response.data;
  } catch (error) {
    console.error('❌ Error sending file:', error.message);
    throw error;
  }
}

/**
 * Download file from WhatsApp message
 */
async function downloadFile(downloadUrl, fileName) {
  try {
    const response = await axios.get(downloadUrl, {
      responseType: 'stream'
    });

    const tempDir = path.join(__dirname, '..', 'public', 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const filePath = path.join(tempDir, fileName);
    const writer = fs.createWriteStream(filePath);

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log(`📥 File downloaded: ${fileName}`);
        resolve(filePath);
      });
      writer.on('error', reject);
    });
  } catch (error) {
    console.error('❌ Error downloading file:', error.message);
    throw error;
  }
}

module.exports = {
  sendTextMessage,
  sendFileByUrl,
  downloadFile
};
