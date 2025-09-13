const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * Green API WhatsApp Service
 * Handles sending messages and files via Green API
 */

const GREEN_API_ID_INSTANCE = process.env.GREEN_API_ID_INSTANCE || 'your_instance_id';
const GREEN_API_API_TOKEN_INSTANCE = process.env.GREEN_API_API_TOKEN_INSTANCE || 'your_api_token';

/**
 * Send text message via Green API
 */
async function sendTextMessage(chatId, message) {
  try {
    const url = `https://api.green-api.com/waInstance${GREEN_API_ID_INSTANCE}/sendMessage/${GREEN_API_API_TOKEN_INSTANCE}`;
    
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
    const url = `https://api.green-api.com/waInstance${GREEN_API_ID_INSTANCE}/sendFileByUrl/${GREEN_API_API_TOKEN_INSTANCE}`;
    
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

    console.log(`📤 File sent to ${chatId}: ${fileName}${caption ? ' with caption: ' + caption : ''}`);
    return response.data;
  } catch (error) {
    console.error('❌ Error sending file:', error.message);
    
    // Log the response details if available for debugging
    if (error.response) {
      console.error(`❌ Green API Error: ${error.response.status} - ${error.response.statusText}`);
      console.error('❌ Response data:', error.response.data);
    }
    
    throw error;
  }
}

/**
 * Download file from WhatsApp message and return as Buffer
 */
async function downloadFile(downloadUrl, fileName = null) {
  try {
    console.log(`📥 Downloading file from: ${downloadUrl}`);
    
    const response = await axios.get(downloadUrl, {
      responseType: 'arraybuffer'
    });

    const buffer = Buffer.from(response.data);
    console.log(`📥 File downloaded as buffer: ${buffer.length} bytes`);
    
    // If fileName is provided, also save to file (for backward compatibility)
    if (fileName) {
      const tempDir = path.join(__dirname, '..', 'public', 'tmp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const filePath = path.join(tempDir, fileName);
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
  sendTextMessage,
  sendFileByUrl,
  downloadFile
};
