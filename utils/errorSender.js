/**
 * Error Sender Utility
 * 
 * Centralized utility for sending error messages to users.
 * SSOT for error message sending - eliminates code duplication (DRY).
 */

const { sendTextMessage } = require('../services/greenApiService');
const { formatProviderError, extractErrorMessage } = require('./errorHandler');

/**
 * Default typing time for error messages (ms)
 */
const DEFAULT_TYPING_TIME = 1000;

/**
 * Common error message templates
 */
const ERROR_MESSAGES = {
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
};

/**
 * Send error message to user
 * @param {string} chatId - Chat ID
 * @param {any} error - Error object or string
 * @param {Object} [options] - Options
 * @param {string} [options.provider] - Provider name (for formatProviderError)
 * @param {string} [options.context] - Error context (e.g., 'PROCESSING', 'EXECUTION')
 * @param {string} [options.customMessage] - Custom error message
 * @param {string} [options.quotedMessageId] - Optional: ID of message to quote
 * @param {number} [options.typingTime] - Typing time in ms (default: 1000)
 */
async function sendErrorToUser(chatId, error, options = {}) {
  const {
    provider,
    context,
    customMessage,
    quotedMessageId = null,
    typingTime = DEFAULT_TYPING_TIME
  } = options;

  let errorMessage;

  // If custom message provided, use it
  if (customMessage) {
    errorMessage = customMessage;
  }
  // If provider specified, use formatProviderError
  else if (provider) {
    const errorText = typeof error === 'string' ? error : (error?.message || error?.error || ERROR_MESSAGES.UNKNOWN_ERROR);
    errorMessage = formatProviderError(provider, errorText);
  }
  // If context specified, use template
  else if (context && ERROR_MESSAGES[context]) {
    const errorText = typeof error === 'string' ? error : (error?.message || error?.error || ERROR_MESSAGES.UNKNOWN_ERROR);
    errorMessage = `❌ ${ERROR_MESSAGES[context]}: ${errorText}`;
  }
  // Default: use extractErrorMessage with generic prefix
  else {
    const errorText = extractErrorMessage(error, ERROR_MESSAGES.UNKNOWN);
    errorMessage = `❌ ${errorText}`;
  }

  try {
    await sendTextMessage(chatId, errorMessage, quotedMessageId, typingTime);
  } catch (sendError) {
    console.error('❌ Failed to send error message to user:', sendError.message);
    // Don't throw - error sending shouldn't break the flow
  }
}

module.exports = {
  sendErrorToUser,
  ERROR_MESSAGES,
  DEFAULT_TYPING_TIME
};

