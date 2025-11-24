/**
 * Async Processors
 * 
 * Async wrappers for media processing operations.
 * Extracted from whatsappRoutes.js (Phase 4.6)
 */

import * as mediaHandlers from '../../services/whatsapp/mediaHandlers';
import { sendErrorToUser } from '../../utils/errorSender';
import { extractQuotedMessageId } from '../../utils/messageHelpers';
import logger from '../../utils/logger';

interface ImageData {
    chatId: string;
    senderId: string;
    senderName: string;
    imageUrl: string;
    prompt: string;
    originalMessageId: string;
    service: string;
}

interface VoiceData {
    chatId: string;
    senderId: string;
    senderName: string;
    audioUrl: string;
    originalMessageId: string;
}

interface VideoData {
    chatId: string;
    senderId: string;
    senderName: string;
    videoUrl: string;
    prompt: string;
    originalMessageId: string;
    service?: string;
}

export function processImageEditAsync(imageData: ImageData) {
  // Run in background without blocking webhook response
  mediaHandlers.handleImageEdit(imageData).catch(async (error: any) => {
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
export function processImageToVideoAsync(imageData: ImageData) {
  // Run in background without blocking webhook response
  mediaHandlers.handleImageToVideo(imageData).catch(async (error: any) => {
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
export function processVoiceMessageAsync(voiceData: VoiceData) {
  // Run in background without blocking webhook response
  mediaHandlers.handleVoiceMessage(voiceData).catch((error: any) => {
    logger.error('❌ Error in async voice processing:', { error: error.message || error });
  });
}

/**
 * Process video-to-video message asynchronously (no await from webhook)
 */
export function processVideoToVideoAsync(videoData: VideoData) {
  // Run in background without blocking webhook response
  mediaHandlers.handleVideoToVideo(videoData).catch(async (error: any) => {
    logger.error('❌ Error in async video-to-video processing:', { error: error.message || error });
    try {
      const quotedMessageId = extractQuotedMessageId({ originalMessageId: videoData.originalMessageId });
      await sendErrorToUser(videoData.chatId, error, { context: 'PROCESSING_VIDEO', quotedMessageId });
    } catch (sendError) {
      logger.error('❌ Failed to send error message to user:', { error: sendError, chatId: videoData.chatId });
    }
  });
}
