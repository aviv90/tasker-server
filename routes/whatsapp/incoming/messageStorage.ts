/**
 * Centralized Message Storage Service
 * 
 * SSOT (Single Source of Truth) for saving incoming user messages to DB cache.
 * Ensures all user messages are saved for conversation context, regardless of message type.
 * 
 * This creates duplication with Green API, but is necessary for:
 * - Fast agent history retrieval (DB cache vs slow Green API)
 * - Complete conversation context preservation
 * - Performance optimization (10 messages from DB vs API call)
 */

import conversationManager from '../../../services/conversationManager';
import logger from '../../../utils/logger';
import { WebhookData } from '../../../services/whatsapp/types';

/**
 * Save incoming user message to DB cache
 * Handles all message types: text, media, audio, etc.
 * 
 * @param webhookData - Webhook data from Green API
 * @param messageText - Parsed message text (can be empty for media-only messages)
 * @param metadata - Additional metadata (imageUrl, videoUrl, audioUrl, etc.)
 */
export async function saveIncomingUserMessage(
  webhookData: WebhookData,
  messageText: string | null | undefined,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    const chatId = webhookData.senderData.chatId;

    if (!conversationManager.isInitialized) {
      logger.debug('💾 [MessageStorage] DB not initialized, skipping message save');
      return;
    }

    // Determine message content
    // For media-only messages (no text), create a descriptive placeholder
    let content = messageText?.trim() || '';

    if (!content) {
      // Create descriptive content for media-only messages
      const parts: string[] = [];
      if (metadata.imageUrl) parts.push('[תמונה]');
      if (metadata.videoUrl) parts.push('[וידאו]');
      if (metadata.audioUrl) parts.push('[אודיו]');
      if (webhookData.messageData.typeMessage === 'audioMessage') parts.push('[הקלטה קולית]');

      if (parts.length > 0) {
        content = parts.join(' ');
      } else {
        // Unknown message type - still save with generic placeholder
        content = '[הודעה]';
      }
    }

    // Skip empty messages
    if (!content || content.trim().length === 0) {
      logger.debug('💾 [MessageStorage] Skipping empty message');
      return;
    }

    // Build comprehensive metadata
    const fullMetadata: Record<string, unknown> = {
      ...metadata,
      messageId: webhookData.idMessage,
      typeMessage: webhookData.messageData.typeMessage,
      timestamp: webhookData.messageData.timestamp || Date.now()
    };

    // Check for duplicate message (prevent saving same message twice)
    // This can happen if webhook is called multiple times or message is edited
    // We use messageId from Green API as unique identifier
    try {
      // Note: We don't check for duplicates here to avoid extra DB query overhead
      // The deduplication is handled at webhook level (processedMessagesCache NodeCache)
      // If needed, we could add a unique constraint on (chat_id, metadata->>'messageId')

      // Save to DB
      // Use container's messages service directly (no deprecation warning)
      const containerModule = await import('../../../services/container');
      const container = containerModule.default;
      if (container.isInitialized) {
        const messagesManager = container.getService('messages');
        await messagesManager.addMessage(chatId, 'user', content, fullMetadata);
      }
      logger.debug(`💾 [MessageStorage] Saved user message to DB cache: ${content.substring(0, 50)}...`);
    } catch (error) {
      // If duplicate key error (if we add unique constraint), log and continue
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('duplicate') || errorMessage.includes('unique')) {
        logger.debug(`💾 [MessageStorage] Duplicate message detected (already saved): ${webhookData.idMessage}`);
        return; // Silently skip duplicate
      }
      throw error; // Re-throw other errors
    }

  } catch (error) {
    // Don't fail if DB save fails - this is a performance optimization
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(`⚠️ [MessageStorage] Failed to save user message to DB cache: ${errorMessage}`);
  }
}

/**
 * Extract media metadata from webhook data
 * @param webhookData - Webhook data from Green API
 * @returns Metadata object with media URLs
 */
export function extractMediaMetadata(webhookData: WebhookData): Record<string, unknown> {
  const messageData = webhookData.messageData;
  const metadata: Record<string, unknown> = {};

  // Extract image URL
  if (messageData.typeMessage === 'imageMessage' || messageData.typeMessage === 'image') {
    metadata.imageUrl = messageData.downloadUrl ||
      messageData.urlFile ||
      messageData.imageMessageData?.downloadUrl;
  }

  // Extract video URL
  if (messageData.typeMessage === 'videoMessage' || messageData.typeMessage === 'video') {
    metadata.videoUrl = messageData.downloadUrl ||
      messageData.urlFile ||
      messageData.videoMessageData?.downloadUrl;
  }

  // Extract audio URL
  if (messageData.typeMessage === 'audioMessage' || messageData.typeMessage === 'audio') {
    metadata.audioUrl = messageData.downloadUrl ||
      messageData.urlFile ||
      messageData.audioMessageData?.downloadUrl;
  }

  return metadata;
}

