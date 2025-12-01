/**
 * Green API Messaging Functions
 */

import axios from 'axios';
import { BASE_URL, GREEN_API_API_TOKEN_INSTANCE } from './constants';
import { TIME } from '../../utils/constants';
import logger from '../../utils/logger';
// Lazy load conversationManager to avoid circular dependency
function getConversationManager() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const conversationManagerModule = require('../../services/conversationManager');
  return conversationManagerModule.default || conversationManagerModule;
}

/**
 * Send text message via Green API
 * @param chatId - Chat ID
 * @param message - Message text
 * @param quotedMessageId - Optional: ID of message to quote
 * @param typingTime - Optional: Typing indicator duration in milliseconds (default: TIME.TYPING_INDICATOR)
 */
export async function sendTextMessage(
  chatId: string,
  message: string,
  quotedMessageId: string | null = null,
  typingTime: number = TIME.TYPING_INDICATOR
): Promise<unknown> {
  try {
    const url = `${BASE_URL}/sendMessage/${GREEN_API_API_TOKEN_INSTANCE}`;

    const data: Record<string, unknown> = {
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

    // Mark message as bot message in cache (if idMessage is in response)
    if (response.data && (response.data as { idMessage?: string }).idMessage) {
      await getConversationManager().markAsBotMessage(chatId, (response.data as { idMessage: string }).idMessage);
    }

    return response.data;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Error sending text message:', { error: errorMessage, chatId });
    throw error;
  }
}

/**
 * Send file by URL via Green API
 * @param chatId - Chat ID
 * @param fileUrl - File URL
 * @param fileName - File name
 * @param caption - Optional caption
 * @param quotedMessageId - Optional: ID of message to quote
 * @param typingTime - Optional: Typing indicator duration in milliseconds (default: TIME.TYPING_INDICATOR)
 */
export async function sendFileByUrl(
  chatId: string,
  fileUrl: string,
  fileName: string,
  caption: string = '',
  quotedMessageId: string | null = null,
  typingTime: number = TIME.TYPING_INDICATOR
): Promise<unknown> {
  try {
    const url = `${BASE_URL}/sendFileByUrl/${GREEN_API_API_TOKEN_INSTANCE}`;

    const data: Record<string, unknown> = {
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

    // Mark message as bot message in cache (if idMessage is in response)
    if (response.data && (response.data as { idMessage?: string }).idMessage) {
      await getConversationManager().markAsBotMessage(chatId, (response.data as { idMessage: string }).idMessage);
    }

    return response.data;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Error sending file:', { error: errorMessage, fileName, chatId });

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
        fileName,
        chatId
      });
    }

    throw error;
  }
}

/**
 * Send poll message via Green API
 * @param chatId - Chat ID
 * @param message - Poll question
 * @param options - Poll options
 * @param multipleAnswers - Allow multiple answers
 * @param quotedMessageId - Optional: ID of message to quote
 * @param typingTime - Optional: Typing indicator duration in milliseconds (default: TIME.TYPING_INDICATOR)
 */
export async function sendPoll(
  chatId: string,
  message: string,
  options: string[],
  multipleAnswers: boolean = false,
  _quotedMessageId: string | null = null, // Not used - see comment below
  typingTime: number = TIME.TYPING_INDICATOR
): Promise<unknown> {
  try {
    const url = `${BASE_URL}/sendPoll/${GREEN_API_API_TOKEN_INSTANCE}`;

    // Green API expects options as an array of objects with 'optionName' key
    // See: https://green-api.com/en/docs/api/sending/SendPoll/
    const formattedOptions = options.map(opt => ({ optionName: opt }));

    const data: Record<string, unknown> = {
      chatId: chatId,
      message: message,
      options: formattedOptions,
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

    // Mark message as bot message in cache (if idMessage is in response)
    if (response.data && (response.data as { idMessage?: string }).idMessage) {
      await getConversationManager().markAsBotMessage(chatId, (response.data as { idMessage: string }).idMessage);
    }

    return response.data;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Error sending poll:', { error: errorMessage, chatId });

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
      logger.error('❌ Response data:', { responseData: axiosError.response.data, chatId });
    }

    throw error;
  }
}

/**
 * Send location message via Green API
 * @param chatId - Chat ID
 * @param latitude - Latitude
 * @param longitude - Longitude
 * @param nameLocation - Optional location name
 * @param address - Optional address
 * @param quotedMessageId - Optional: ID of message to quote
 * @param typingTime - Optional: Typing indicator duration in milliseconds (default: TIME.TYPING_INDICATOR)
 */
export async function sendLocation(
  chatId: string,
  latitude: number,
  longitude: number,
  nameLocation: string = '',
  address: string = '',
  quotedMessageId: string | null = null,
  typingTime: number = TIME.TYPING_INDICATOR
): Promise<unknown> {
  try {
    const url = `${BASE_URL}/sendLocation/${GREEN_API_API_TOKEN_INSTANCE}`;

    const data: Record<string, unknown> = {
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

    // Mark message as bot message in cache (if idMessage is in response)
    if (response.data && (response.data as { idMessage?: string }).idMessage) {
      await getConversationManager().markAsBotMessage(chatId, (response.data as { idMessage: string }).idMessage);
    }

    return response.data;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Error sending location:', { error: errorMessage, chatId });

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

