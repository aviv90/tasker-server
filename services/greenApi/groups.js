/**
 * Green API Group Functions
 */

const axios = require('axios');
const FormData = require('form-data');
const { BASE_URL, GREEN_API_API_TOKEN_INSTANCE } = require('./constants');
const logger = require('../../utils/logger');

/**
 * Create a new WhatsApp group
 */
async function createGroup(groupName, participantIds) {
  try {
    const url = `${BASE_URL}/createGroup/${GREEN_API_API_TOKEN_INSTANCE}`;

    const data = {
      groupName: groupName,
      chatIds: participantIds
    };

    logger.info(`👥 Creating group: "${groupName}" with ${participantIds.length} participants`, { 
      groupName, 
      participantCount: participantIds.length,
      participants: participantIds 
    });

    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.data) {
      throw new Error('No data received from createGroup');
    }

    logger.info(`✅ Group created successfully: ${response.data.chatId || 'unknown ID'}`, { 
      groupName, 
      chatId: response.data.chatId,
      participantCount: participantIds.length 
    });
    return response.data;
  } catch (error) {
    logger.error('❌ Error creating group:', { error: error.message, groupName, participantCount: participantIds.length });

    // Log the response details if available for debugging
    if (error.response) {
      logger.error(`❌ Green API Error: ${error.response.status} - ${error.response.statusText}`, { 
        responseData: error.response.data,
        groupName 
      });
    }

    throw error;
  }
}

/**
 * Set group picture
 */
async function setGroupPicture(groupId, imageBuffer) {
  try {
    const url = `${BASE_URL}/setGroupPicture/${GREEN_API_API_TOKEN_INSTANCE}`;

    const formData = new FormData();
    formData.append('groupId', groupId);
    formData.append('file', imageBuffer, {
      filename: 'group_picture.jpg',
      contentType: 'image/jpeg'
    });

    logger.info(`🖼️ Setting group picture for: ${groupId}`, { groupId });

    const response = await axios.post(url, formData, {
      headers: {
        ...formData.getHeaders()
      }
    });

    if (!response.data) {
      throw new Error('No data received from setGroupPicture');
    }

    if (response.data.setGroupPicture) {
      logger.info(`✅ Group picture set successfully: ${response.data.urlAvatar || 'unknown URL'}`, { groupId });
    } else {
      logger.warn(`⚠️ Failed to set group picture: ${response.data.reason || 'unknown reason'}`, { groupId, reason: response.data.reason });
    }

    return response.data;
  } catch (error) {
    logger.error('❌ Error setting group picture:', { error: error.message, groupId });

    // Log the response details if available for debugging
    if (error.response) {
      logger.error(`❌ Green API Error: ${error.response.status} - ${error.response.statusText}`, { 
        responseData: error.response.data,
        groupId 
      });
    }

    throw error;
  }
}

module.exports = {
  createGroup,
  setGroupPicture
};

