/**
 * Green API Chat Functions
 */

import axios from 'axios';
import { BASE_URL, GREEN_API_API_TOKEN_INSTANCE } from './constants';
import logger from '../../utils/logger';

/**
 * Get chat history (last N messages) from Green API
 */
export async function getChatHistory(chatId: string, count: number = 10): Promise<unknown[]> {
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

    logger.info(`📜 Retrieved ${(response.data as unknown[]).length || 0} messages from chat history`, { chatId, count });
    return response.data as unknown[];
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Error getting chat history:', { error: errorMessage, chatId, count });

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
        chatId 
      });
    }

    throw error;
  }
}

/**
 * Get all contacts and groups from Green API
 */
export async function getContacts(): Promise<unknown[]> {
  try {
    const url = `${BASE_URL}/getContacts/${GREEN_API_API_TOKEN_INSTANCE}`;

    logger.info(`📇 Fetching contacts from Green API...`);

    const response = await axios.get(url);

    if (!response.data) {
      throw new Error('No data received from getContacts');
    }

    logger.info(`✅ Retrieved ${(response.data as unknown[]).length || 0} contacts`);
    return response.data as unknown[];
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Error fetching contacts:', { error: errorMessage });
    throw error;
  }
}

/**
 * Get a specific message by ID
 * Useful for fetching quoted messages with media downloadUrl
 */
export async function getMessage(chatId: string, idMessage: string): Promise<unknown> {
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

    const messageData = response.data as { type?: string };
    logger.info(`✅ Message retrieved: ${messageData.type || 'unknown type'}`, { chatId, idMessage, messageType: messageData.type });
    return response.data;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Error fetching message:', { error: errorMessage, chatId, idMessage });
    throw error;
  }
}

