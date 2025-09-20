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
    console.log(`📥 Downloading file from URL (${downloadUrl.length} chars)`);
    
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

/**
 * Send voice message via Green API
 * Uses sendFileByUrl with proper voice message formatting
 */
async function sendVoiceMessage(chatId, audioUrl, fileName = null) {
  try {
    console.log(`🎤 Sending voice message to ${chatId}: ${audioUrl}`);
    
    // Ensure the fileName has the correct extension based on the audio format
    let voiceFileName = fileName;
    if (!voiceFileName) {
      // Extract format from URL or default to mp3
      const urlFormat = audioUrl.includes('.mp3') ? 'mp3' : 
                       audioUrl.includes('.ogg') ? 'ogg' : 
                       audioUrl.includes('.wav') ? 'wav' : 'mp3';
      voiceFileName = `voice_${Date.now()}.${urlFormat}`;
    } else {
      // Ensure the fileName extension matches the actual audio format
      const urlFormat = audioUrl.includes('.mp3') ? 'mp3' : 
                       audioUrl.includes('.ogg') ? 'ogg' : 
                       audioUrl.includes('.wav') ? 'wav' : 'mp3';
      const currentExt = path.extname(voiceFileName).slice(1).toLowerCase();
      
      if (currentExt !== urlFormat) {
        const baseName = path.basename(voiceFileName, path.extname(voiceFileName));
        voiceFileName = `${baseName}.${urlFormat}`;
        console.log(`🔄 Corrected filename extension to match audio format: ${voiceFileName}`);
      }
    }
    
    const url = `https://api.green-api.com/waInstance${GREEN_API_ID_INSTANCE}/sendFileByUrl/${GREEN_API_API_TOKEN_INSTANCE}`;
    
    const data = {
      chatId: chatId,
      urlFile: audioUrl,
      fileName: voiceFileName,
      caption: '' // Voice messages should not have captions
    };

    console.log(`🎤 Sending voice message with data:`, {
      chatId,
      urlFile: audioUrl,
      fileName: voiceFileName
    });
    
    // Additional validation before sending
    console.log(`🔍 Voice message validation:`);
    console.log(`   - URL accessible: ${audioUrl}`);
    console.log(`   - File extension: ${path.extname(voiceFileName)}`);
    console.log(`   - Expected format: MP3 (based on ElevenLabs output)`);

    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log(`✅ Voice message sent to ${chatId}: ${voiceFileName}`);
    return response.data;
  } catch (error) {
    console.error('❌ Error sending voice message:', error.message);
    
    // Log the response details if available for debugging
    if (error.response) {
      console.error(`❌ Green API Error: ${error.response.status} - ${error.response.statusText}`);
      console.error('❌ Response data:', error.response.data);
    }
    
    throw error;
  }
}

/**
 * Get chat history (last N messages) from Green API
 */
async function getChatHistory(chatId, count = 10) {
  try {
    console.log(`📜 Getting last ${count} messages from chat: ${chatId}`);
    
    const url = `https://api.green-api.com/waInstance${GREEN_API_ID_INSTANCE}/getChatHistory/${GREEN_API_API_TOKEN_INSTANCE}`;
    
    const data = {
      chatId: chatId,
      count: count
    };

    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log(`📜 Retrieved ${response.data.length || 0} messages from chat history`);
    return response.data;
  } catch (error) {
    console.error('❌ Error getting chat history:', error.message);
    
    // Log the response details if available for debugging
    if (error.response) {
      console.error(`❌ Green API Error: ${error.response.status} - ${error.response.statusText}`);
      console.error('❌ Response data:', error.response.data);
    }
    
    throw error;
  }
}

module.exports = {
  sendTextMessage,
  sendFileByUrl,
  sendVoiceMessage,
  downloadFile,
  getChatHistory
};
