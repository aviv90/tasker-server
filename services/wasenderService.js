/**
 * WaSender API WhatsApp Service
 * Handles sending messages through WaSender API
 */

const { getStaticFileUrl } = require('../utils/urlUtils');

/**
 * Send text message via WaSender API
 * @param {string} chatId - WhatsApp chat ID (e.g., "972543995202@c.us")
 * @param {string} message - Text message to send
 */
async function sendTextMessage(chatId, message) {
  try {
    const apiKey = process.env.WASENDER_API_KEY;
    
    if (!apiKey) {
      console.error('❌ WaSender API credentials not configured');
      throw new Error('WaSender API credentials missing');
    }

    const payload = {
      messageType: "text",
      to: chatId,
      text: message
    };

    console.log(`📤 Sending text message via WaSender API to ${chatId}`);

    const response = await fetch('https://www.wasenderapi.com/api/send-message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ WaSender API send message error:', errorText);
      throw new Error(`WaSender API error: ${response.status}`);
    }

    const result = await response.json();
    console.log('✅ Text message sent successfully:', result);
    return result;

  } catch (error) {
    console.error('❌ Error sending WaSender text message:', error);
    throw error;
  }
}

/**
 * Send file by URL via WaSender API
 * @param {string} chatId - WhatsApp chat ID
 * @param {string} fileUrl - Public URL of the file to send
 * @param {string} caption - Optional caption for the file
 * @param {string} fileName - Optional file name
 */
async function sendFileByUrl(chatId, fileUrl, caption = "", fileName = "") {
  try {
    const apiKey = process.env.WASENDER_API_KEY;
    
    if (!apiKey) {
      console.error('❌ WaSender API credentials not configured');
      throw new Error('WaSender API credentials missing');
    }

    // Determine message type based on file extension
    const ext = fileUrl.split('.').pop()?.toLowerCase();
    let messageType = 'document'; // default
    
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
      messageType = 'image';
    } else if (['mp4', 'avi', 'mov', 'webm'].includes(ext)) {
      messageType = 'video';
    } else if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) {
      messageType = 'audio';
    }

    const payload = {
      messageType,
      to: chatId,
      url: fileUrl,
      ...(caption && { caption }),
      ...(fileName && { fileName })
    };

    console.log(`📎 Sending ${messageType} file via WaSender API to ${chatId}:`, fileUrl);

    const response = await fetch('https://www.wasenderapi.com/api/send-message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ WaSender API send file error:', errorText);
      throw new Error(`WaSender API error: ${response.status}`);
    }

    const result = await response.json();
    console.log('✅ File sent successfully:', result);
    return result;

  } catch (error) {
    console.error('❌ Error sending WaSender file:', error);
    throw error;
  }
}

/**
 * Download file from WaSender API
 * @param {string} downloadUrl - Download URL from WaSender API
 * @returns {Promise<Buffer>} - File buffer
 */
async function downloadFile(downloadUrl) {
  try {
    console.log('📥 Downloading file from WaSender API:', downloadUrl);
    
    const response = await fetch(downloadUrl);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ WaSender API download error:', errorText);
      throw new Error(`Download failed: ${response.status}`);
    }
    
    const fileBuffer = Buffer.from(await response.arrayBuffer());
    console.log(`✅ File downloaded successfully, size: ${fileBuffer.length} bytes`);
    return fileBuffer;
    
  } catch (error) {
    console.error('❌ Error downloading file from WaSender API:', error);
    throw error;
  }
}

module.exports = {
  sendTextMessage,
  sendFileByUrl,
  downloadFile
};
