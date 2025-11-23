/**
 * Green API Messaging Functions
 */

const axios = require('axios');
const { BASE_URL, GREEN_API_API_TOKEN_INSTANCE } = require('./constants');
const { TIME } = require('../../utils/constants');
const logger = require('../../utils/logger');

/**
 * Send text message via Green API
 * @param {string} chatId - Chat ID
 * @param {string} message - Message text
 * @param {string} [quotedMessageId] - Optional: ID of message to quote
 * @param {number} [typingTime] - Optional: Typing indicator duration in milliseconds (default: TIME.TYPING_INDICATOR)
 */
async function sendTextMessage(chatId, message, quotedMessageId = null, typingTime = TIME.TYPING_INDICATOR) {
  try {
    const url = `${BASE_URL}/sendMessage/${GREEN_API_API_TOKEN_INSTANCE}`;

    const data = {
      chatId: chatId,
      message: message,
      typingTime: typingTime
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

    logger.info(`📤 Message sent to ${chatId}:`, { message: message.substring(0, 50) + '...' });
    return response.data;
  } catch (error) {
    logger.error('❌ Error sending text message:', { error: error.message, chatId });
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
 * @param {number} [typingTime] - Optional: Typing indicator duration in milliseconds (default: TIME.TYPING_INDICATOR)
 */
async function sendFileByUrl(chatId, fileUrl, fileName, caption = '', quotedMessageId = null, typingTime = TIME.TYPING_INDICATOR) {
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

    // Add typingTime parameter
    data.typingTime = typingTime;

    logger.info(`📤 Sending file: ${fileName} to ${chatId}`);

    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    logger.info(`✅ File sent to ${chatId}: ${fileName}${caption ? ' with caption: ' + caption : ''}`);
    return response.data;
  } catch (error) {
    logger.error('❌ Error sending file:', { error: error.message, fileName, chatId });

    // Log the response details if available for debugging
    if (error.response) {
      logger.error(`❌ Green API Error: ${error.response.status} - ${error.response.statusText}`, { 
        responseData: error.response.data,
        fileName,
        chatId
      });
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
 * @param {number} [typingTime] - Optional: Typing indicator duration in milliseconds (default: TIME.TYPING_INDICATOR)
 */
async function sendPoll(chatId, message, options, multipleAnswers = false, quotedMessageId = null, typingTime = TIME.TYPING_INDICATOR) {
  try {
    const url = `${BASE_URL}/sendPoll/${GREEN_API_API_TOKEN_INSTANCE}`;

    const data = {
      chatId: chatId,
      message: message,
      options: options,
      multipleAnswers: multipleAnswers
    };

    // Add typingTime parameter
    data.typingTime = typingTime;

    // CRITICAL: quotedMessageId is NOT included for polls.
    // Investigation showed that including it causes the poll to NOT be delivered,
    // even though the API returns 200 OK. This is likely a Green API bug or limitation
    // regarding quoting in sendPoll specifically.
    // See: https://green-api.com/en/docs/api/sending/SendPoll/ (says it's supported, but fails in practice)
    // DO NOT add quotedMessageId to data - it will prevent poll delivery!

    logger.info(`📊 [sendPoll] Sending poll to ${chatId}:`, {
      question: message.substring(0, 50),
      optionsCount: options.length,
      quotedMessageId: 'DISABLED_TO_ENSURE_DELIVERY' // data.quotedMessageId || 'NONE'
    });

    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    logger.info(`✅ [sendPoll] Poll sent successfully to ${chatId}: "${message}" with ${options.length} options`);
    return response.data;
  } catch (error) {
    logger.error('❌ Error sending poll:', { error: error.message, chatId });

    // Log the response details if available for debugging
    if (error.response) {
      logger.error(`❌ Green API Error: ${error.response.status} - ${error.response.statusText}`, { 
        responseData: error.response.data,
        chatId 
      });
      logger.error('❌ Response data:', { responseData: error.response.data, chatId });
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
 * @param {number} [typingTime] - Optional: Typing indicator duration in milliseconds (default: TIME.TYPING_INDICATOR)
 */
async function sendLocation(chatId, latitude, longitude, nameLocation = '', address = '', quotedMessageId = null, typingTime = TIME.TYPING_INDICATOR) {
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

    // Add typingTime parameter
    data.typingTime = typingTime;

    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    logger.info(`📍 Location sent to ${chatId}: ${latitude}, ${longitude}`);
    return response.data;
  } catch (error) {
    logger.error('❌ Error sending location:', { error: error.message, chatId });

    // Log the response details if available for debugging
    if (error.response) {
      logger.error(`❌ Green API Error: ${error.response.status} - ${error.response.statusText}`, { 
        responseData: error.response.data,
        fileName,
        chatId
      });
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

