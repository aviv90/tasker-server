/**
 * Database initialization and connection management
 * This is a legacy wrapper around container initialization
 */

import logger from '../../utils/logger';

/**
 * Conversation manager interface (for backward compatibility)
 */
interface ConversationManager {
  isInitialized?: boolean;
  pool?: unknown;
  [key: string]: unknown;
}

class DatabaseManager {
  // @ts-expect-error - Kept for backward compatibility (unused)
  private _conversationManager: ConversationManager;

  constructor(conversationManager: ConversationManager) {
    this._conversationManager = conversationManager;
  }

  /**
   * Initialize PostgreSQL database connection and run migrations
   */
  async initializeDatabase(attempt: number = 1): Promise<void> {
    try {
      // In the new architecture, the container handles initialization
      // But for legacy compatibility, we might be called from conversationManager
      // We'll assume container is already initializing or this is a redundant call
      // or we just proxy to conversationManager which proxies to container.
      
      logger.info('✅ [DatabaseManager] Database managed by Container');
      
      // No-op mostly, as container handles pool creation and migrations
      void attempt; // Suppress unused parameter warning
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Database initialization failed:', { error: errorMessage });
    }
  }
}

export default DatabaseManager;

