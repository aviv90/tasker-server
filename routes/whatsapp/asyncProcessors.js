/**
 * Async Processors
 * 
 * Async wrappers for media processing operations.
 * Extracted from whatsappRoutes.js (Phase 4.6)
 */

const { handleImageEdit, handleImageToVideo, handleVoiceMessage, handleVideoToVideo } = require('../../services/whatsapp/mediaHandlers');
const { sendTextMessage } = require('../../services/greenApiService');
const { sendErrorToUser, ERROR_MESSAGES } = require('../../utils/errorSender');
const { extractQuotedMessageId } = require('../../utils/messageHelpers');

function processImageEditAsync(imageData) {
  // Run in background without blocking webhook response
  handleImageEdit(imageData).catch(async error => {
    logger.error('❌ Error in async image edit processing:', { error: error.message || error });
    try {
      const quotedMessageId = extractQuotedMessageId({ originalMessageId: imageData.originalMessageId });
      await sendErrorToUser(imageData.chatId, error, { context: 'PROCESSING_IMAGE', quotedMessageId });
    } catch (sendError) {
      logger.error('❌ Failed to send error message to user:', { error: sendError, chatId: imageData.chatId });
    }
  });
}

/**
 * Process image-to-video message asynchronously (no await from webhook)
 */
function processImageToVideoAsync(imageData) {
  // Run in background without blocking webhook response
  handleImageToVideo(imageData).catch(async error => {
    logger.error('❌ Error in async image-to-video processing:', { error: error.message || error });
    try {
      const quotedMessageId = extractQuotedMessageId({ originalMessageId: imageData.originalMessageId });
      await sendErrorToUser(imageData.chatId, error, { context: 'CREATING_VIDEO', quotedMessageId });
    } catch (sendError) {
      logger.error('❌ Failed to send error message to user:', { error: sendError, chatId: imageData.chatId });
    }
  });
}

/**
 * Process voice message asynchronously (no await from webhook)
 */
function processVoiceMessageAsync(voiceData) {
  // Run in background without blocking webhook response
  handleVoiceMessage(voiceData).catch(error => {
    logger.error('❌ Error in async voice processing:', { error: error.message || error });
  });
}

/**
 * Process video-to-video message asynchronously (no await from webhook)
 */
function processVideoToVideoAsync(videoData) {
  // Run in background without blocking webhook response
  handleVideoToVideo(videoData).catch(async error => {
    logger.error('❌ Error in async video-to-video processing:', { error: error.message || error });
    try {
      const quotedMessageId = extractQuotedMessageId({ originalMessageId: videoData.originalMessageId });
      await sendErrorToUser(videoData.chatId, error, { context: 'PROCESSING_VIDEO', quotedMessageId });
    } catch (sendError) {
      logger.error('❌ Failed to send error message to user:', { error: sendError, chatId: imageData.chatId });
    }
  });
}

module.exports = {
  processImageEditAsync,
  processImageToVideoAsync,
  processVoiceMessageAsync,
  processVideoToVideoAsync
};
