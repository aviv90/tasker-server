/**
 * Agent context management (persistent storage)
 */

const logger = require('../../utils/logger');
const { contextSchema } = require('../../schemas/context.schema');

class AgentContextManager {
  constructor(conversationManager, repository) {
    this.conversationManager = conversationManager; // Kept for backward compatibility
    this.repository = repository;
  }

  /**
   * Save agent context to database (persistent storage)
   */
  async saveAgentContext(chatId, context) {
    if (!this.repository) {
      logger.warn('⚠️ Repository not initialized, cannot save agent context');
      return;
    }

    try {
      // Validate context structure
      const validatedContext = contextSchema.parse({
        toolCalls: context.toolCalls,
        generatedAssets: context.generatedAssets
      });

      await this.repository.upsert(chatId, validatedContext.toolCalls, validatedContext.generatedAssets);
      logger.debug(`💾 [Agent Context] Saved to DB for chat ${chatId}`);
    } catch (error) {
      logger.error('❌ Error saving agent context:', error.message);
    }
  }

  /**
   * Get agent context from database
   */
  async getAgentContext(chatId) {
    if (!this.repository) {
      logger.warn('⚠️ Repository not initialized, cannot get agent context');
      return null;
    }

    try {
      return await this.repository.findByChatId(chatId);
    } catch (error) {
      logger.error('❌ Error getting agent context:', error.message);
      return null;
    }
  }

  /**
   * Clear agent context for a chat
   */
  async clearAgentContext(chatId) {
    if (!this.repository) {
      logger.warn('⚠️ Repository not initialized, cannot clear agent context');
      return;
    }

    try {
      await this.repository.deleteByChatId(chatId);
      logger.debug(`🗑️ [Agent Context] Cleared for chat ${chatId}`);
    } catch (error) {
      logger.error('❌ Error clearing agent context:', error.message);
    }
  }

  /**
   * Clean up old agent context (older than specified days)
   * @param {number} olderThanDays - Delete context older than X days (default: 30)
   * @returns {number} - Number of rows deleted
   */
  async cleanupOldAgentContext(olderThanDays = 30) {
    if (!this.repository) {
      logger.warn('⚠️ Repository not initialized, cannot cleanup agent context');
      return 0;
    }

    try {
      const deletedCount = await this.repository.deleteOlderThanDays(olderThanDays);
      
      if (deletedCount > 0) {
        logger.info(`🧹 [Agent Context Cleanup] Deleted ${deletedCount} old context(s) (older than ${olderThanDays} days)`);
      } else {
        logger.debug(`✅ [Agent Context Cleanup] No old contexts found`);
      }

      return deletedCount;
    } catch (error) {
      logger.error('❌ Error cleaning up old agent context:', error.message);
      return 0;
    }
  }
}

module.exports = AgentContextManager;
