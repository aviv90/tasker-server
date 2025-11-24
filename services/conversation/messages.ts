/**
 * Conversation messages management
 * 
 * @deprecated Messages are no longer stored in DB to avoid duplication.
 * All messages are retrieved from Green API getChatHistory when needed.
 * 
 * This class is kept for backward compatibility only and should not be used in new code.
 * Use Green API getChatHistory via chatHistoryService instead.
 */

import { CacheKeys, CacheTTL, get, set, invalidatePattern } from '../../utils/cache';
import logger from '../../utils/logger';
import { Pool } from 'pg';

/**
 * Conversation manager interface (for backward compatibility)
 */
interface ConversationManager {
  isInitialized?: boolean;
  pool?: Pool;
  maxMessages?: number;
  summariesManager?: {
    generateAutomaticSummary: (chatId: string) => Promise<unknown>;
  };
  [key: string]: unknown;
}

/**
 * Message metadata structure
 */
interface MessageMetadata {
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  [key: string]: unknown;
}

/**
 * Conversation history message structure
 */
interface ConversationMessage {
  role: string;
  content: string;
  metadata: MessageMetadata;
  timestamp: number;
}

class MessagesManager {
  private conversationManager: ConversationManager;

  constructor(conversationManager: ConversationManager) {
    this.conversationManager = conversationManager;
  }

  /**
   * Add a message to user's conversation history
   * @param chatId - Chat ID
   * @param role - Role (user/model)
   * @param content - Message content
   * @param metadata - Optional metadata (imageUrl, videoUrl, audioUrl, etc.)
   */
  async addMessage(chatId: string, role: string, content: string, metadata: MessageMetadata = {}): Promise<number> {
    if (!this.conversationManager.isInitialized || !this.conversationManager.pool) {
      throw new Error('Database not initialized');
    }

    const client = await (this.conversationManager.pool as Pool).connect();
    
    try {
      const timestamp = Date.now();
      
      // Insert the new message
      const result = await client.query(`
        INSERT INTO conversations (chat_id, role, content, metadata, timestamp)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [chatId, role, content, JSON.stringify(metadata), timestamp]);
      
      const messageId = result.rows[0]?.id;
      if (!messageId) {
        throw new Error('Failed to get message ID from insert');
      }

      logger.debug(`💬 Added ${role} message to ${chatId}`, { messageId, role });
      
      // Invalidate conversation history cache (new message added)
      const cacheKeyParts = CacheKeys.conversationHistory(chatId).split(':');
      invalidatePattern(cacheKeyParts.slice(0, 2).join(':'));
        
      // Keep only the last N messages for this chat
      await this.trimMessagesForChat(chatId);
      
      // 🤖 Automatic Summary Generation Trigger
      // Every X messages, generate a summary asynchronously (don't await - run in background)
      const SUMMARY_TRIGGER_INTERVAL = Number(process.env.AUTO_SUMMARY_INTERVAL) || 100;
      
      // Get message count for this chat
      const countResult = await client.query(`
        SELECT COUNT(*) as count
        FROM conversations
        WHERE chat_id = $1
      `, [chatId]);
      
      const messageCount = parseInt(countResult.rows[0]?.count as string || '0', 10);
      
      // Trigger summary every SUMMARY_TRIGGER_INTERVAL messages
      if (messageCount % SUMMARY_TRIGGER_INTERVAL === 0 && messageCount > 0 && this.conversationManager.summariesManager) {
        logger.info(`📊 [Auto-Summary] Triggering summary generation for chat ${chatId}`, { messageCount });
        
        // Run in background (don't await)
        this.conversationManager.summariesManager.generateAutomaticSummary(chatId).catch((error: unknown) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          logger.error(`❌ [Auto-Summary] Failed for chat ${chatId}`, {
            error: {
              message: errorMessage,
              stack: errorStack
            }
          });
        });
      }
      
      return messageId;
    } finally {
      client.release();
    }
  }

  /**
   * Trim messages to keep only the last N messages for a specific chat
   */
  async trimMessagesForChat(chatId: string): Promise<void> {
    if (!this.conversationManager.isInitialized || !this.conversationManager.pool) {
      return;
    }
        
    const client = await (this.conversationManager.pool as Pool).connect();
    
    try {
      // Delete old messages, keeping only the last maxMessages
      const maxMessages = this.conversationManager.maxMessages || 1000;
      await client.query(`
          DELETE FROM conversations 
        WHERE chat_id = $1 
          AND id NOT IN (
            SELECT id FROM conversations 
          WHERE chat_id = $1 
            ORDER BY timestamp DESC 
          LIMIT $2
        )
      `, [chatId, maxMessages]);
    } finally {
      client.release();
    }
  }

  /**
   * Get conversation history for a specific chat (with caching)
   */
  async getConversationHistory(chatId: string, limit: number | null = null): Promise<ConversationMessage[]> {
    if (!this.conversationManager.isInitialized || !this.conversationManager.pool) {
      return [];
    }

    // Try cache first
    const cacheKey = CacheKeys.conversationHistory(chatId, limit || 50);
    const cached = get<ConversationMessage[]>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const client = await (this.conversationManager.pool as Pool).connect();
    
    try {
      let query = `
        SELECT role, content, metadata, timestamp
        FROM conversations 
        WHERE chat_id = $1 
        ORDER BY timestamp ASC
      `;
      
      const params: (string | number)[] = [chatId];
      
      if (limit) {
        query += ` LIMIT $2`;
        params.push(limit);
      }
      
      const result = await client.query(query, params);
      
      const history: ConversationMessage[] = result.rows.map(row => ({
        role: row.role,
        content: row.content,
        metadata: (row.metadata as MessageMetadata) || {},
        timestamp: row.timestamp
      }));
      
      // Cache for 2 minutes (conversation history changes frequently)
      set(cacheKey, history, CacheTTL.SHORT * 2);
      
      return history;
    } finally {
      client.release();
    }
  }
}

export default MessagesManager;

