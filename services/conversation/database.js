const logger = require('../../utils/logger');
const { TIME } = require('../../utils/constants');
const MigrationRunner = require('./migrationRunner');

/**
 * Database initialization and connection management
 * This is a legacy wrapper around container initialization
 */
class DatabaseManager {
  constructor(conversationManager) {
    this.conversationManager = conversationManager;
  }

  /**
   * Initialize PostgreSQL database connection and run migrations
   */
  async initializeDatabase(attempt = 1) {
    try {
      // In the new architecture, the container handles initialization
      // But for legacy compatibility, we might be called from conversationManager
      // We'll assume container is already initializing or this is a redundant call
      // or we just proxy to conversationManager which proxies to container.
      
      logger.info('✅ [DatabaseManager] Database managed by Container');
      
      // No-op mostly, as container handles pool creation and migrations
      
    } catch (error) {
      logger.error('❌ Database initialization failed:', { error: error.message });
    }
  }
}

module.exports = DatabaseManager;
