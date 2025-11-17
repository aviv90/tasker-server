/**
 * Green API Chat Functions
 */

const axios = require('axios');
const { BASE_URL, GREEN_API_API_TOKEN_INSTANCE } = require('./constants');

/**
 * Get chat history (last N messages) from Green API
 */
async function getChatHistory(chatId, count = 10) {
  try {
    console.log(`📜 Getting last ${count} messages from chat: ${chatId}`);

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
    const url = `${BASE_URL}/getContacts/${GREEN_API_API_TOKEN_INSTANCE}`;

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
    const url = `${BASE_URL}/getMessage/${GREEN_API_API_TOKEN_INSTANCE}`;

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

module.exports = {
  getChatHistory,
  getContacts,
  getMessage
};

