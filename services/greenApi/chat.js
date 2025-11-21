/**
 * Green API Chat Functions
 */

const axios = require('axios');
const { BASE_URL, GREEN_API_API_TOKEN_INSTANCE } = require('./constants');
const logger = require('../../utils/logger');

/**
 * Get chat history (last N messages) from Green API
 */
async function getChatHistory(chatId, count = 10) {
  try {
    logger.info(`📜 Getting last ${count} messages from chat: ${chatId}`);

    const url = `${BASE_URL}/getChatHistory/${GREEN_API_API_TOKEN_INSTANCE}`;

    const data = {
      chatId: chatId,
      count: count
    };

    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    logger.info(`📜 Retrieved ${response.data.length || 0} messages from chat history`, { chatId, count });
    return response.data;
  } catch (error) {
    logger.error('❌ Error getting chat history:', { error: error.message, chatId, count });

    // Log the response details if available for debugging
    if (error.response) {
      logger.error(`❌ Green API Error: ${error.response.status} - ${error.response.statusText}`, { 
        responseData: error.response.data,
        chatId 
      });
    }

    throw error;
  }
}

/**
 * Get all contacts and groups from Green API
 */
async function getContacts() {
  try {
    const url = `${BASE_URL}/getContacts/${GREEN_API_API_TOKEN_INSTANCE}`;

    logger.info(`📇 Fetching contacts from Green API...`);

    const response = await axios.get(url);

    if (!response.data) {
      throw new Error('No data received from getContacts');
    }

    logger.info(`✅ Retrieved ${response.data.length || 0} contacts`);
    return response.data;
  } catch (error) {
    logger.error('❌ Error fetching contacts:', { error: error.message });
    throw error;
  }
}

/**
 * Get a specific message by ID
 * Useful for fetching quoted messages with media downloadUrl
 */
async function getMessage(chatId, idMessage) {
  try {
    const url = `${BASE_URL}/getMessage/${GREEN_API_API_TOKEN_INSTANCE}`;

    const data = {
      chatId: chatId,
      idMessage: idMessage
    };

    logger.info(`📨 Fetching message ${idMessage} from chat ${chatId}`, { chatId, idMessage });

    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.data) {
      throw new Error('No data received from getMessage');
    }

    logger.info(`✅ Message retrieved: ${response.data.type || 'unknown type'}`, { chatId, idMessage, messageType: response.data.type });
    return response.data;
  } catch (error) {
    logger.error('❌ Error fetching message:', { error: error.message, chatId, idMessage });
    throw error;
  }
}

module.exports = {
  getChatHistory,
  getContacts,
  getMessage
};

