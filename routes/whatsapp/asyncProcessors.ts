/**
 * Async Processors
 * 
 * Async wrappers for media processing operations.
 * 
 * NOTE: Image edit, image-to-video, and video-to-video operations are now handled
 * by the Agent through its tools (edit_image, image_to_video, edit_video).
 * Only voice message processing remains here for automatic transcription.
 */

import * as mediaHandlers from '../../services/whatsapp/mediaHandlers';
import logger from '../../utils/logger';

interface VoiceData {
    chatId: string;
    senderId: string;
    senderName: string;
    audioUrl: string;
    originalMessageId: string;
}

/**
 * Process voice message asynchronously (no await from webhook)
 * Used for automatic voice transcription for authorized users
 */
export function processVoiceMessageAsync(voiceData: VoiceData) {
  // Run in background without blocking webhook response
  mediaHandlers.handleVoiceMessage(voiceData).catch((error: any) => {
    logger.error('❌ Error in async voice processing:', { error: error.message || error });
  });
}
