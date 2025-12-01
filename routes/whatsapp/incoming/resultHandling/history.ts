/**
 * Result Handling - History Management
 * Handles saving bot responses to conversation history
 */

import logger from '../../../../utils/logger';
import { AgentResult } from './types';

/**
 * Save bot response to conversation history (DB cache for fast retrieval)
 * @param chatId - Chat ID
 * @param agentResult - Agent result
 */
export async function saveBotResponse(chatId: string, agentResult: AgentResult): Promise<void> {
  try {
    // Use dynamic import to avoid circular dependencies
    const containerModule = await import('../../../../services/container');
    const container = containerModule.default;
    if (!container.isInitialized) {
      logger.debug('💾 [Agent] DB not initialized, skipping bot response save');
      return;
    }

    // Save text response if available
    if (agentResult.text && agentResult.text.trim()) {
      const cleanText = agentResult.text.trim();
      const metadata: Record<string, unknown> = {};
      if (agentResult.imageUrl) metadata.imageUrl = agentResult.imageUrl;
      if (agentResult.videoUrl) metadata.videoUrl = agentResult.videoUrl;
      if (agentResult.audioUrl) metadata.audioUrl = agentResult.audioUrl;

      // Use container's messages service directly (no deprecation warning)
      const messagesManager = container.getService('messages');
      await messagesManager.addMessage(chatId, 'assistant', cleanText, metadata);
      logger.debug(`💾 [Agent] Saved bot text response to DB cache: ${cleanText.substring(0, 50)}...`);
    }

    // Note: Media URLs are already saved with text above via metadata
    // Bot messages are also tracked in message_types table when sent through Green API
  } catch (error) {
    // Don't fail if DB save fails - this is a performance optimization
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(`⚠️ [Agent] Failed to save bot response to DB cache: ${errorMessage}`);
  }
}

