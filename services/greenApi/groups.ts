/**
 * Green API Group Functions
 */

import axios from 'axios';
import FormData from 'form-data';
import { BASE_URL, GREEN_API_API_TOKEN_INSTANCE } from './constants';
import logger from '../../utils/logger';

/**
 * Create a new WhatsApp group
 */
export async function createGroup(groupName: string, participantIds: string[]): Promise<unknown> {
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

    const responseData = response.data as { chatId?: string };
    logger.info(`✅ Group created successfully: ${responseData.chatId || 'unknown ID'}`, {
      groupName,
      chatId: responseData.chatId,
      participantCount: participantIds.length
    });
    return response.data;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Error creating group:', { error: errorMessage, groupName, participantCount: participantIds.length });

    // Log the response details if available for debugging
    interface AxiosError {
      response?: {
        status?: number;
        statusText?: string;
        data?: unknown;
      };
    }
    const axiosError = error as AxiosError;
    if (axiosError.response) {
      logger.error(`❌ Green API Error: ${axiosError.response.status} - ${axiosError.response.statusText}`, {
        responseData: axiosError.response.data,
        groupName
      });
    }

    throw error;
  }
}

/**
 * Set group picture
 */
export async function setGroupPicture(groupId: string, imageBuffer: Buffer): Promise<unknown> {
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

    const responseData = response.data as { setGroupPicture?: boolean; urlAvatar?: string; reason?: string };
    if (responseData.setGroupPicture) {
      logger.info(`✅ Group picture set successfully: ${responseData.urlAvatar || 'unknown URL'}`, { groupId });
    } else {
      logger.warn(`⚠️ Failed to set group picture: ${responseData.reason || 'unknown reason'}`, { groupId, reason: responseData.reason });
    }

    return response.data;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Error setting group picture:', { error: errorMessage, groupId });

    // Log the response details if available for debugging
    interface AxiosError {
      response?: {
        status?: number;
        statusText?: string;
        data?: unknown;
      };
    }
    const axiosError = error as AxiosError;
    if (axiosError.response) {
      logger.error(`❌ Green API Error: ${axiosError.response.status} - ${axiosError.response.statusText}`, {
        responseData: axiosError.response.data,
        groupId
      });
    }

    throw error;
  }
}

/**
 * Get group invite link
 */
export async function getGroupInviteLink(groupId: string): Promise<string | null> {
  try {
    const url = `${BASE_URL}/getGroupInviteLink/${GREEN_API_API_TOKEN_INSTANCE}`;

    const data = {
      chatId: groupId
    };

    logger.info(`🔗 Getting invite link for group: ${groupId}`);

    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.data) {
      throw new Error('No data received from getGroupInviteLink');
    }

    const responseData = response.data as { inviteLink?: string };

    if (responseData.inviteLink) {
      logger.info(`✅ Got invite link: ${responseData.inviteLink}`);
      return responseData.inviteLink;
    } else {
      logger.warn(`⚠️ No invite link returned for group: ${groupId}`);
      return null;
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Error getting group invite link:', { error: errorMessage, groupId });
    return null;
  }
}

