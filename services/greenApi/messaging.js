/**
 * Green API Messaging Functions
 */

const axios = require('axios');
const { BASE_URL, GREEN_API_API_TOKEN_INSTANCE } = require('./constants');

/**
 * Send text message via Green API
 * @param {string} chatId - Chat ID
 * @param {string} message - Message text
 * @param {string} [quotedMessageId] - Optional: ID of message to quote
 */
async function sendTextMessage(chatId, message, quotedMessageId = null) {
  try {
    const url = `${BASE_URL}/sendMessage/${GREEN_API_API_TOKEN_INSTANCE}`;

    const data = {
      chatId: chatId,
      message: message
    };

    // Add quoted message ID if provided
    if (quotedMessageId) {
      data.quotedMessageId = quotedMessageId;
    }

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
 * @param {string} chatId - Chat ID
 * @param {string} fileUrl - File URL
 * @param {string} fileName - File name
 * @param {string} [caption] - Optional caption
 * @param {string} [quotedMessageId] - Optional: ID of message to quote
 */
async function sendFileByUrl(chatId, fileUrl, fileName, caption = '', quotedMessageId = null) {
  try {
    const url = `${BASE_URL}/sendFileByUrl/${GREEN_API_API_TOKEN_INSTANCE}`;

    const data = {
      chatId: chatId,
      urlFile: fileUrl,
      fileName: fileName,
      caption: caption
    };

    // Add quoted message ID if provided
    if (quotedMessageId) {
      data.quotedMessageId = quotedMessageId;
    }

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
 * @param {string} chatId - Chat ID
 * @param {string} message - Poll question
 * @param {Array} options - Poll options
 * @param {boolean} [multipleAnswers] - Allow multiple answers
 * @param {string} [quotedMessageId] - Optional: ID of message to quote
 */
async function sendPoll(chatId, message, options, multipleAnswers = false, quotedMessageId = null) {
  try {
    const url = `${BASE_URL}/sendPoll/${GREEN_API_API_TOKEN_INSTANCE}`;

    const data = {
      chatId: chatId,
      message: message,
      options: options,
      multipleAnswers: multipleAnswers
    };

    // NOTE: quotedMessageId is temporarily disabled for polls.
    // Investigation showed that including it causes the poll to NOT be delivered,
    // even though the API returns 200 OK. This is likely a Green API bug or limitation
    // regarding quoting in sendPoll specifically.
    // See: https://green-api.com/en/docs/api/sending/SendPoll/ (says it's supported, but fails in practice)
    /*
    if (quotedMessageId && typeof quotedMessageId === 'string' && quotedMessageId.trim().length > 0) {
       console.log(`🔍 [sendPoll] Adding quotedMessageId: "${quotedMessageId}"`);
       data.quotedMessageId = quotedMessageId;
    }
    */

    console.log(`📊 [sendPoll] Sending poll to ${chatId}:`, {
      question: message.substring(0, 50),
      optionsCount: options.length,
      quotedMessageId: 'DISABLED_TO_ENSURE_DELIVERY' // data.quotedMessageId || 'NONE'
    });

    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log(`✅ [sendPoll] Poll sent successfully to ${chatId}: "${message}" with ${options.length} options`);
    return response.data;
  } catch (error) {
    console.error('❌ Error sending poll:', error.message);

    // Log the response details if available for debugging
    if (error.response) {
      console.error(`❌ Green API Error: ${error.response.status} - ${error.response.statusText}`);
      console.error('❌ Response data:', JSON.stringify(error.response.data, null, 2));
    }

    throw error;
  }
}

/**
 * Send location message via Green API
 * @param {string} chatId - Chat ID
 * @param {number} latitude - Latitude
 * @param {number} longitude - Longitude
 * @param {string} [nameLocation] - Optional location name
 * @param {string} [address] - Optional address
 * @param {string} [quotedMessageId] - Optional: ID of message to quote
 */
async function sendLocation(chatId, latitude, longitude, nameLocation = '', address = '', quotedMessageId = null) {
  try {
    const url = `${BASE_URL}/sendLocation/${GREEN_API_API_TOKEN_INSTANCE}`;

    const data = {
      chatId: chatId,
      latitude: latitude,
      longitude: longitude,
      nameLocation: nameLocation,
      address: address
    };

    // Add quoted message ID if provided
    if (quotedMessageId) {
      data.quotedMessageId = quotedMessageId;
    }

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

