/**
 * Async Processors
 * 
 * Async wrappers for media processing operations.
 * Extracted from whatsappRoutes.js (Phase 4.6)
 */

const { handleImageEdit, handleImageToVideo, handleVoiceMessage, handleVideoToVideo } = require('../../services/whatsapp/mediaHandlers');
const { sendTextMessage } = require('../../services/greenApiService');
const { sendErrorToUser, ERROR_MESSAGES } = require('../../utils/errorSender');

function processImageEditAsync(imageData) {
  // Run in background without blocking webhook response
  handleImageEdit(imageData).catch(async error => {
    console.error('❌ Error in async image edit processing:', error.message || error);
    try {
      const quotedMessageId = imageData.originalMessageId || null;
      await sendErrorToUser(imageData.chatId, error, { context: 'PROCESSING_IMAGE', quotedMessageId });
    } catch (sendError) {
      console.error('❌ Failed to send error message to user:', sendError);
    }
  });
}

/**
 * Process image-to-video message asynchronously (no await from webhook)
 */
function processImageToVideoAsync(imageData) {
  // Run in background without blocking webhook response
  handleImageToVideo(imageData).catch(async error => {
    console.error('❌ Error in async image-to-video processing:', error.message || error);
    try {
      const quotedMessageId = imageData.originalMessageId || null;
      await sendErrorToUser(imageData.chatId, error, { context: 'CREATING_VIDEO', quotedMessageId });
    } catch (sendError) {
      console.error('❌ Failed to send error message to user:', sendError);
    }
  });
}

/**
 * Process voice message asynchronously (no await from webhook)
 */
function processVoiceMessageAsync(voiceData) {
  // Run in background without blocking webhook response
  handleVoiceMessage(voiceData).catch(error => {
    console.error('❌ Error in async voice processing:', error.message || error);
  });
}

/**
 * Process video-to-video message asynchronously (no await from webhook)
 */
function processVideoToVideoAsync(videoData) {
  // Run in background without blocking webhook response
  handleVideoToVideo(videoData).catch(async error => {
    console.error('❌ Error in async video-to-video processing:', error.message || error);
    try {
      const quotedMessageId = videoData.originalMessageId || null;
      await sendErrorToUser(videoData.chatId, error, { context: 'PROCESSING_VIDEO', quotedMessageId });
    } catch (sendError) {
      console.error('❌ Failed to send error message to user:', sendError);
    }
  });
}

module.exports = {
  processImageEditAsync,
  processImageToVideoAsync,
  processVoiceMessageAsync,
  processVideoToVideoAsync
};
