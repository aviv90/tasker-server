/**
 * Agent context management (persistent storage)
 */

const logger = require('../../utils/logger');
const AgentContextRepository = require('../../repositories/agentContextRepository');

class AgentContextManager {
  constructor(conversationManager) {
    this.conversationManager = conversationManager;
    this.repository = null;
  }

  _getRepository() {
    if (!this.repository && this.conversationManager.pool) {
        this.repository = new AgentContextRepository(this.conversationManager.pool);
    }
    return this.repository;
  }

  /**
   * Save agent context to database (persistent storage)
   */
  async saveAgentContext(chatId, context) {
    if (!this.conversationManager.isInitialized) {
      logger.warn('⚠️ Database not initialized, cannot save agent context');
      return;
    }

    try {
      await this._getRepository().upsert(chatId, context.toolCalls, context.generatedAssets);
      logger.debug(`💾 [Agent Context] Saved to DB for chat ${chatId}`);
    } catch (error) {
      logger.error('❌ Error saving agent context:', error.message);
    }
  }

  /**
   * Get agent context from database
   */
  async getAgentContext(chatId) {
    if (!this.conversationManager.isInitialized) {
      logger.warn('⚠️ Database not initialized, cannot get agent context');
      return null;
    }

    try {
      return await this._getRepository().findByChatId(chatId);
    } catch (error) {
      logger.error('❌ Error getting agent context:', error.message);
      return null;
    }
  }

  /**
   * Clear agent context for a chat
   */
  async clearAgentContext(chatId) {
    if (!this.conversationManager.isInitialized) {
      logger.warn('⚠️ Database not initialized, cannot clear agent context');
      return;
    }

    try {
      await this._getRepository().deleteByChatId(chatId);
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
    if (!this.conversationManager.isInitialized) {
      logger.warn('⚠️ Database not initialized, cannot cleanup agent context');
      return 0;
    }

    try {
      const deletedCount = await this._getRepository().deleteOlderThanDays(olderThanDays);
      
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
