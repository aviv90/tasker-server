/**
 * Error Sender Utility
 * 
 * Centralized utility for sending error messages to users.
 * SSOT for error message sending - eliminates code duplication (DRY).
 */

import { sendTextMessage } from '../services/greenApiService';
import { formatProviderError, extractErrorMessage } from './errorHandler';
import logger from './logger';
import { TIME } from './constants';

/**
 * Default typing time for error messages (ms)
 * Uses TIME constant for consistency
 */
export const DEFAULT_TYPING_TIME = TIME.TYPING_INDICATOR;

/**
 * Common error message templates
 */
export const ERROR_MESSAGES = {
  PROCESSING: 'שגיאה בעיבוד הפקודה',
  EXECUTION: 'שגיאה בביצוע הפקודה',
  REQUEST: 'שגיאה בעיבוד הבקשה',
  SENDING: 'שגיאה בשליחת',
  TRANSCRIPTION: 'לא הצלחתי לתמלל את ההקלטה',
  VOICE_RESPONSE: 'לא הצלחתי ליצור תגובה קולית',
  PROCESSING_VOICE: 'שגיאה בעיבוד ההקלטה הקולית',
  PROCESSING_IMAGE: 'שגיאה בעריכת התמונה',
  PROCESSING_VIDEO: 'שגיאה בעיבוד הווידאו',
  CREATING_VIDEO: 'שגיאה ביצירת וידאו מהתמונה',
  SENDING_SONG: 'שגיאה בשליחת השיר',
  SENDING_POLL: 'שגיאה בשליחת הסקר',
  UNKNOWN: 'לא הצלחתי לעבד את הבקשה',
  UNKNOWN_ERROR: 'שגיאה לא ידועה'
} as const;

/**
 * Error context type
 */
export type ErrorContext = keyof typeof ERROR_MESSAGES;

/**
 * Options for sending error messages
 */
export interface SendErrorOptions {
  provider?: string;
  context?: ErrorContext;
  customMessage?: string;
  quotedMessageId?: string | null;
  typingTime?: number;
}

/**
 * Error object that may contain message or error field
 */
interface ErrorWithMessage {
  message?: string;
  error?: string | unknown;
}

/**
 * Send error message to user
 * @param chatId - Chat ID
 * @param error - Error object or string
 * @param options - Options for error message formatting
 */
export async function sendErrorToUser(
  chatId: string,
  error: unknown,
  options: SendErrorOptions = {}
): Promise<void> {
  const {
    provider,
    context,
    customMessage,
    quotedMessageId = null,
    typingTime = DEFAULT_TYPING_TIME
  } = options;

  let errorMessage: string;

  // If custom message provided, use it
  if (customMessage) {
    errorMessage = customMessage;
  }
  // If provider specified, use formatProviderError
  else if (provider) {
    const errorText = typeof error === 'string' 
      ? error 
      : ((error as ErrorWithMessage)?.message || 
         (error as ErrorWithMessage)?.error || 
         ERROR_MESSAGES.UNKNOWN_ERROR);
    errorMessage = formatProviderError(provider, errorText);
  }
  // If context specified, use template
  else if (context && ERROR_MESSAGES[context]) {
    const errorText = typeof error === 'string' 
      ? error 
      : ((error as ErrorWithMessage)?.message || 
         (error as ErrorWithMessage)?.error || 
         ERROR_MESSAGES.UNKNOWN_ERROR);
    errorMessage = `❌ ${ERROR_MESSAGES[context]}: ${errorText}`;
  }
  // Default: use extractErrorMessage with generic prefix
  else {
    const errorText = extractErrorMessage(error, ERROR_MESSAGES.UNKNOWN);
    errorMessage = `❌ ${errorText}`;
  }

  try {
    await sendTextMessage(chatId, errorMessage, quotedMessageId || undefined, typingTime);
  } catch (sendError) {
    logger.error('❌ Failed to send error message to user:', { 
      error: sendError instanceof Error ? sendError.message : String(sendError), 
      chatId 
    });
    // Don't throw - error sending shouldn't break the flow
  }
}

// Backward compatibility: CommonJS export
module.exports = {
  sendErrorToUser,
  ERROR_MESSAGES,
  DEFAULT_TYPING_TIME
};

