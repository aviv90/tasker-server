/**
 * Green API Group Functions
 */

const axios = require('axios');
const FormData = require('form-data');
const { BASE_URL, GREEN_API_API_TOKEN_INSTANCE } = require('./constants');

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

module.exports = {
  createGroup,
  setGroupPicture
};

