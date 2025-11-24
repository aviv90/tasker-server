/**
 * Agent context management (persistent storage)
 */

import logger from '../../utils/logger';
import { contextSchema } from '../../schemas/context.schema';
import AgentContextRepository from '../../repositories/agentContextRepository';

/**
 * Agent context structure
 */
interface AgentContext {
  toolCalls?: unknown[];
  generatedAssets?: {
    images?: unknown[];
    videos?: unknown[];
    audio?: unknown[];
  };
}

/**
 * Conversation manager interface (for backward compatibility)
 */
interface ConversationManager {
  [key: string]: unknown;
}

class AgentContextManager {
  // @ts-expect-error - Kept for backward compatibility (unused)
  private _conversationManager: ConversationManager;
  private repository: AgentContextRepository | null;

  constructor(conversationManager: ConversationManager, repository: AgentContextRepository | null) {
    this._conversationManager = conversationManager;
    this.repository = repository;
  }

  /**
   * Save agent context to database (persistent storage)
   */
  async saveAgentContext(chatId: string, context: AgentContext): Promise<void> {
    if (!this.repository) {
      logger.warn('⚠️ Repository not initialized, cannot save agent context');
      return;
    }

    try {
      // Validate context structure
      const validatedContext = contextSchema.parse({
        toolCalls: context.toolCalls || [],
        generatedAssets: context.generatedAssets || { images: [], videos: [], audio: [] }
      });

      await this.repository.upsert(
        chatId, 
        validatedContext.toolCalls, 
        validatedContext.generatedAssets
      );
      logger.debug(`💾 [Agent Context] Saved to DB for chat ${chatId}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error saving agent context:', { error: errorMessage });
    }
  }

  /**
   * Get agent context from database
   */
  async getAgentContext(chatId: string): Promise<AgentContext | null> {
    if (!this.repository) {
      logger.warn('⚠️ Repository not initialized, cannot get agent context');
      return null;
    }

    try {
      return await this.repository.findByChatId(chatId);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error getting agent context:', { error: errorMessage });
      return null;
    }
  }

  /**
   * Clear agent context for a chat
   */
  async clearAgentContext(chatId: string): Promise<void> {
    if (!this.repository) {
      logger.warn('⚠️ Repository not initialized, cannot clear agent context');
      return;
    }

    try {
      await this.repository.deleteByChatId(chatId);
      logger.debug(`🗑️ [Agent Context] Cleared for chat ${chatId}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error clearing agent context:', { error: errorMessage });
    }
  }

  /**
   * Clean up old agent context (older than specified days)
   * @param olderThanDays - Delete context older than X days (default: 30)
   * @returns Number of rows deleted
   */
  async cleanupOldAgentContext(olderThanDays: number = 30): Promise<number> {
    if (!this.repository) {
      logger.warn('⚠️ Repository not initialized, cannot cleanup agent context');
      return 0;
    }

    try {
      const deletedCount = await this.repository.deleteOlderThanDays(olderThanDays);
      
      if (deletedCount > 0) {
        logger.info(`🧹 [Agent Context Cleanup] Deleted ${deletedCount} old context(s) (older than ${olderThanDays} days)`);
      } else {
        logger.debug('✅ [Agent Context Cleanup] No old contexts found');
      }

      return deletedCount;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error cleaning up old agent context:', { error: errorMessage });
      return 0;
    }
  }
}

export default AgentContextManager;

