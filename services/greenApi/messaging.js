/**
 * Green API Messaging Functions
 */

const axios = require('axios');
const { BASE_URL, GREEN_API_API_TOKEN_INSTANCE } = require('./constants');

/**
 * Send text message via Green API
 */
async function sendTextMessage(chatId, message) {
  try {
    const url = `${BASE_URL}/sendMessage/${GREEN_API_API_TOKEN_INSTANCE}`;

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
    const url = `${BASE_URL}/sendFileByUrl/${GREEN_API_API_TOKEN_INSTANCE}`;

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

/**
 * Send poll message via Green API
 */
async function sendPoll(chatId, message, options, multipleAnswers = false) {
  try {
    const url = `${BASE_URL}/sendPoll/${GREEN_API_API_TOKEN_INSTANCE}`;

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
 */
async function sendLocation(chatId, latitude, longitude, nameLocation = '', address = '') {
  try {
    const url = `${BASE_URL}/sendLocation/${GREEN_API_API_TOKEN_INSTANCE}`;

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
  sendPoll,
  sendLocation
};

