/**
 * Green API WhatsApp Service
 * Handles sending messages through Green API
 */

/**
 * Send text message via Green API
 * @param {string} chatId - WhatsApp chat ID (e.g., "972543995202@c.us")
 * @param {string} message - Text message to send
 */
async function sendTextMessage(chatId, message) {
  try {
    // We'll add the details after we get them from Green API Console
    const instanceId = process.env.GREEN_API_INSTANCE_ID;
    const apiToken = process.env.GREEN_API_TOKEN;
    
    if (!instanceId || !apiToken) {
      console.error('❌ Green API credentials not configured');
      throw new Error('Green API credentials missing');
    }

    const url = `https://api.green-api.com/waInstance${instanceId}/sendMessage/${apiToken}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chatId: chatId,
        message: message
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Green API send error:', errorText);
      throw new Error(`Green API error: ${response.status}`);
    }

    const result = await response.json();
    console.log('✅ Message sent successfully:', result);
    return result;

  } catch (error) {
    console.error('❌ Error sending WhatsApp message:', error);
    throw error;
  }
}

/**
 * Send file (image/audio/video/document) via Green API
 * @param {string} chatId - WhatsApp chat ID
 * @param {string} urlFile - URL of the file to send
 * @param {string} caption - Caption for the file (optional)
 * @param {string} fileName - File name (optional)
 */
async function sendFileByUrl(chatId, urlFile, caption = '', fileName = '') {
  try {
    const instanceId = process.env.GREEN_API_INSTANCE_ID;
    const apiToken = process.env.GREEN_API_TOKEN;
    
    if (!instanceId || !apiToken) {
      throw new Error('Green API credentials missing');
    }

    const url = `https://api.green-api.com/waInstance${instanceId}/sendFileByUrl/${apiToken}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chatId: chatId,
        urlFile: urlFile,
        caption: caption,
        fileName: fileName
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Green API send file error:', errorText);
      throw new Error(`Green API error: ${response.status}`);
    }

    const result = await response.json();
    console.log('✅ File sent successfully:', result);
    return result;

  } catch (error) {
    console.error('❌ Error sending WhatsApp file:', error);
    throw error;
  }
}

module.exports = {
  sendTextMessage,
  sendFileByUrl
};
