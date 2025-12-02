/**
 * Messages Manager
 * 
 * Manages chat history in the database (conversations table).
 * Used as a cache/backup for Green API history.
 */

import { Pool } from 'pg';
import logger from '../../utils/logger';

interface ConversationManager {
    pool: Pool | null;
    [key: string]: unknown;
}

class MessagesManager {
    private conversationManager: ConversationManager;

    constructor(conversationManager: ConversationManager) {
        this.conversationManager = conversationManager;
    }

    private get pool(): Pool | null {
        return this.conversationManager.pool;
    }

    /**
     * Add message to database
     */
    async addMessage(chatId: string, role: string, content: string, metadata: Record<string, unknown> = {}): Promise<number> {
        if (!this.pool) {
            logger.warn('⚠️ Pool not initialized, cannot add message');
            return 0;
        }

        try {
            const query = `
        INSERT INTO conversations (chat_id, role, content, metadata, timestamp)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `;
            const values = [chatId, role, content, JSON.stringify(metadata), Date.now()];
            const result = await this.pool.query(query, values);
            return result.rows[0].id;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('❌ Error adding message to DB:', { error: errorMessage, chatId });
            return 0;
        }
    }

    /**
     * Get conversation history from database
     */
    async getConversationHistory(chatId: string, limit: number | null = null): Promise<unknown[]> {
        if (!this.pool) {
            return [];
        }

        try {
            let query = `
        SELECT role, content, metadata, timestamp
        FROM conversations
        WHERE chat_id = $1
        ORDER BY timestamp DESC
      `;

            const values: any[] = [chatId];

            if (limit) {
                query += ` LIMIT $2`;
                values.push(limit);
            }

            const result = await this.pool.query(query, values);

            // Return in chronological order (oldest first)
            return result.rows.reverse().map(row => ({
                ...row,
                metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
            }));
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('❌ Error getting conversation history from DB:', { error: errorMessage, chatId });
            return [];
        }
    }

    /**
     * Trim messages for chat (keep last N messages)
     */
    async trimMessagesForChat(chatId: string): Promise<void> {
        if (!this.pool) return;

        try {
            // Keep last 50 messages per chat
            const KEEP_LIMIT = 50;

            const query = `
        DELETE FROM conversations
        WHERE chat_id = $1 AND id NOT IN (
          SELECT id FROM conversations
          WHERE chat_id = $1
          ORDER BY timestamp DESC
          LIMIT $2
        )
      `;

            await this.pool.query(query, [chatId, KEEP_LIMIT]);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('❌ Error trimming messages:', { error: errorMessage, chatId });
        }
    }

    /**
     * Clear all conversations
     */
    async clearAllConversations(): Promise<void> {
        if (!this.pool) return;

        try {
            await this.pool.query('DELETE FROM conversations');
            logger.info('🗑️ All conversations cleared from DB');
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('❌ Error clearing all conversations:', { error: errorMessage });
        }
    }

    /**
     * Clear conversations for specific chat
     */
    async clearConversationsForChat(chatId: string): Promise<number> {
        if (!this.pool) return 0;

        try {
            const result = await this.pool.query('DELETE FROM conversations WHERE chat_id = $1', [chatId]);
            return result.rowCount || 0;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('❌ Error clearing conversations for chat:', { error: errorMessage, chatId });
            return 0;
        }
    }
}

export default MessagesManager;
