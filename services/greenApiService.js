const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * Green API WhatsApp Service
 * Handles sending messages and files via Green API
 */

const GREEN_API_ID_INSTANCE = process.env.GREEN_API_ID_INSTANCE || 'your_instance_id';
const GREEN_API_API_TOKEN_INSTANCE = process.env.GREEN_API_API_TOKEN_INSTANCE || 'your_api_token';

const STATIC_DIR = path.join(__dirname, '..', 'public', 'tmp');

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

    console.log(`📤 Sending file: ${fileName} to ${chatId}`);

    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log(`✅ File sent to ${chatId}: ${fileName}${caption ? ' with caption: ' + caption : ''}`);
    return response.data;
  } catch (error) {
    console.error('❌ Error sending file:', error.message);
    console.error(`❌ Failed to send file: ${fileName} to ${chatId}`);
    
    // Log the response details if available for debugging
    if (error.response) {
      console.error(`❌ Green API Error: ${error.response.status} - ${error.response.statusText}`);
      console.error('❌ Response data:', error.response.data);
    }
    
    throw error;
  }
}

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

/**
 * Get all contacts and groups from Green API
 */
async function getContacts() {
  try {
    const url = `https://api.green-api.com/waInstance${GREEN_API_ID_INSTANCE}/getContacts/${GREEN_API_API_TOKEN_INSTANCE}`;
    
    console.log(`📇 Fetching contacts from Green API...`);
    
    const response = await axios.get(url);
    
    if (!response.data) {
      throw new Error('No data received from getContacts');
    }
    
    console.log(`✅ Retrieved ${response.data.length || 0} contacts`);
    return response.data;
  } catch (error) {
    console.error('❌ Error fetching contacts:', error.message);
    throw error;
  }
}

/**
 * Get a specific message by ID
 * Useful for fetching quoted messages with media downloadUrl
 */
async function getMessage(chatId, idMessage) {
  try {
    const url = `https://api.green-api.com/waInstance${GREEN_API_ID_INSTANCE}/getMessage/${GREEN_API_API_TOKEN_INSTANCE}`;
    
    const data = {
      chatId: chatId,
      idMessage: idMessage
    };

    console.log(`📨 Fetching message ${idMessage} from chat ${chatId}`);
    
    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.data) {
      throw new Error('No data received from getMessage');
    }
    
    console.log(`✅ Message retrieved: ${response.data.type || 'unknown type'}`);
    return response.data;
  } catch (error) {
    console.error('❌ Error fetching message:', error.message);
    throw error;
  }
}

/**
 * Create a new WhatsApp group
 * @param {string} groupName - Name of the group
 * @param {Array<string>} participantIds - Array of WhatsApp IDs (e.g., ["972501234567@c.us", "972509876543@c.us"])
 * @returns {Promise<Object>} - Response with group details including groupId
 */
async function createGroup(groupName, participantIds) {
  try {
    const url = `https://api.green-api.com/waInstance${GREEN_API_ID_INSTANCE}/createGroup/${GREEN_API_API_TOKEN_INSTANCE}`;
    
    const data = {
      groupName: groupName,
      chatIds: participantIds
    };

    console.log(`👥 Creating group: "${groupName}" with ${participantIds.length} participants`);
    console.log(`   Participants: ${participantIds.join(', ')}`);
    
    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.data) {
      throw new Error('No data received from createGroup');
    }
    
    console.log(`✅ Group created successfully: ${response.data.chatId || 'unknown ID'}`);
    return response.data;
  } catch (error) {
    console.error('❌ Error creating group:', error.message);
    
    // Log the response details if available for debugging
    if (error.response) {
      console.error(`❌ Green API Error: ${error.response.status} - ${error.response.statusText}`);
      console.error('❌ Response data:', error.response.data);
    }
    
    throw error;
  }
}

/**
 * Set group picture
 * @param {string} groupId - Group chat ID (e.g., "120363043968066561@g.us")
 * @param {Buffer} imageBuffer - Image file buffer (JPEG/PNG)
 * @returns {Promise<Object>} - Response with urlAvatar
 */
async function setGroupPicture(groupId, imageBuffer) {
  try {
    const FormData = require('form-data');
    const url = `https://api.green-api.com/waInstance${GREEN_API_ID_INSTANCE}/setGroupPicture/${GREEN_API_API_TOKEN_INSTANCE}`;
    
    const formData = new FormData();
    formData.append('groupId', groupId);
    formData.append('file', imageBuffer, {
      filename: 'group_picture.jpg',
      contentType: 'image/jpeg'
    });

    console.log(`🖼️ Setting group picture for: ${groupId}`);
    
    const response = await axios.post(url, formData, {
      headers: {
        ...formData.getHeaders()
      }
    });

    if (!response.data) {
      throw new Error('No data received from setGroupPicture');
    }
    
    if (response.data.setGroupPicture) {
      console.log(`✅ Group picture set successfully: ${response.data.urlAvatar || 'unknown URL'}`);
    } else {
      console.log(`⚠️ Failed to set group picture: ${response.data.reason || 'unknown reason'}`);
    }
    
    return response.data;
  } catch (error) {
    console.error('❌ Error setting group picture:', error.message);
    
    // Log the response details if available for debugging
    if (error.response) {
      console.error(`❌ Green API Error: ${error.response.status} - ${error.response.statusText}`);
      console.error('❌ Response data:', error.response.data);
    }
    
    throw error;
  }
}

/**
 * Send poll message via Green API
 * @param {string} chatId - Chat ID
 * @param {string} message - Poll question (max 255 chars)
 * @param {Array} options - Array of option objects [{optionName: 'text'}]
 * @param {boolean} multipleAnswers - Allow multiple answers (default: false)
 * @returns {Promise} - Green API response
 */
async function sendPoll(chatId, message, options, multipleAnswers = false) {
  try {
    const url = `https://api.green-api.com/waInstance${GREEN_API_ID_INSTANCE}/sendPoll/${GREEN_API_API_TOKEN_INSTANCE}`;
    
    const data = {
      chatId: chatId,
      message: message,
      options: options,
      multipleAnswers: multipleAnswers
    };

    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log(`📊 Poll sent to ${chatId}: "${message}" with ${options.length} options`);
    return response.data;
  } catch (error) {
    console.error('❌ Error sending poll:', error.message);
    
    // Log the response details if available for debugging
    if (error.response) {
      console.error(`❌ Green API Error: ${error.response.status} - ${error.response.statusText}`);
      console.error('❌ Response data:', error.response.data);
    }
    
    throw error;
  }
}

/**
 * Send location message via Green API
 * @param {string} chatId - Chat ID
 * @param {number} latitude - Latitude
 * @param {number} longitude - Longitude
 * @param {string} nameLocation - Name of the location (optional)
 * @param {string} address - Address of the location (optional)
 * @returns {Promise} - Green API response
 */
async function sendLocation(chatId, latitude, longitude, nameLocation = '', address = '') {
  try {
    const url = `https://api.green-api.com/waInstance${GREEN_API_ID_INSTANCE}/sendLocation/${GREEN_API_API_TOKEN_INSTANCE}`;
    
    const data = {
      chatId: chatId,
      latitude: latitude,
      longitude: longitude,
      nameLocation: nameLocation,
      address: address
    };

    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log(`📍 Location sent to ${chatId}: ${latitude}, ${longitude}`);
    return response.data;
  } catch (error) {
    console.error('❌ Error sending location:', error.message);
    
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
  downloadFile,
  getChatHistory,
  getContacts,
  getMessage,
  createGroup,
  setGroupPicture,
  sendPoll,
  sendLocation
};
