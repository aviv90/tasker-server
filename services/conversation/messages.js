/**
 * Conversation messages management
 */
class MessagesManager {
  constructor(conversationManager) {
    this.conversationManager = conversationManager;
  }

  /**
   * Add a message to user's conversation history
   * @param {string} chatId - Chat ID
   * @param {string} role - Role (user/model)
   * @param {string} content - Message content
   * @param {Object} metadata - Optional metadata (imageUrl, videoUrl, audioUrl, etc.)
   */
  async addMessage(chatId, role, content, metadata = {}) {
    if (!this.conversationManager.isInitialized) {
      throw new Error('Database not initialized');
    }

    const client = await this.conversationManager.pool.connect();
    
    try {
      const timestamp = Date.now();
      
      // Insert the new message
      const result = await client.query(`
        INSERT INTO conversations (chat_id, role, content, metadata, timestamp)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [chatId, role, content, JSON.stringify(metadata), timestamp]);
      
      const messageId = result.rows[0].id;
      console.log(`💬 Added ${role} message to ${chatId} (ID: ${messageId})`);
        
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
      
      const messageCount = parseInt(countResult.rows[0].count);
      
      // Trigger summary every SUMMARY_TRIGGER_INTERVAL messages
      if (messageCount % SUMMARY_TRIGGER_INTERVAL === 0 && messageCount > 0) {
        console.log(`📊 [Auto-Summary] Triggering summary generation for chat ${chatId} (${messageCount} messages)`);
        
        // Run in background (don't await)
        this.conversationManager.summariesManager.generateAutomaticSummary(chatId).catch(error => {
          console.error(`❌ [Auto-Summary] Failed for chat ${chatId}:`, error.message);
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
  async trimMessagesForChat(chatId) {
    if (!this.conversationManager.isInitialized) {
          return;
        }
        
    const client = await this.conversationManager.pool.connect();
    
    try {
      // Delete old messages, keeping only the last maxMessages
      await client.query(`
          DELETE FROM conversations 
        WHERE chat_id = $1 
          AND id NOT IN (
            SELECT id FROM conversations 
          WHERE chat_id = $1 
            ORDER BY timestamp DESC 
          LIMIT $2
        )
      `, [chatId, this.conversationManager.maxMessages]);
    } finally {
      client.release();
    }
  }

  /**
   * Get conversation history for a specific chat
   */
  async getConversationHistory(chatId) {
    if (!this.conversationManager.isInitialized) {
      return [];
    }

    const client = await this.conversationManager.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT role, content, metadata, timestamp
        FROM conversations 
        WHERE chat_id = $1 
        ORDER BY timestamp ASC
      `, [chatId]);
      
      return result.rows.map(row => ({
        role: row.role,
        content: row.content,
        metadata: row.metadata || {},
        timestamp: row.timestamp
      }));
    } finally {
      client.release();
    }
  }
}

module.exports = MessagesManager;

