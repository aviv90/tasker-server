/**
 * Conversation Manager with SQLite Database
 * Manages user conversation sessions with persistent storage
 * Maintains compatibility with the original in-memory API
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class ConversationManager {
  constructor() {
    this.maxMessages = 10; // Keep only last 10 messages per user
    this.dbPath = path.join(__dirname, '..', 'store', 'conversations.db');
    this.db = null;
    
    this.initializeDatabase();
    
    console.log('💭 ConversationManager initialized with SQLite');
    console.log(`📝 Max messages per session: ${this.maxMessages}`);
    console.log(`💾 Database path: ${this.dbPath}`);
  }

  /**
   * Initialize SQLite database and create tables if they don't exist
   */
  initializeDatabase() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error('❌ Error opening database:', err.message);
          reject(err);
          return;
        }
        
        console.log('📁 Connected to SQLite database');
        
        // Create conversations table
        const createTableSQL = `
          CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `;
        
        this.db.run(createTableSQL, (err) => {
          if (err) {
            console.error('❌ Error creating conversations table:', err.message);
            reject(err);
            return;
          }
          
          // Create index for performance
          const createIndexSQL = `
            CREATE INDEX IF NOT EXISTS idx_chat_timestamp 
            ON conversations(chat_id, timestamp DESC)
          `;
          
          this.db.run(createIndexSQL, (err) => {
            if (err) {
              console.error('❌ Error creating index:', err.message);
              reject(err);
              return;
            }
            
            console.log('✅ Database tables and indexes ready');
            resolve();
          });
        });
      });
    });
  }

  /**
   * Add a message to user's conversation history
   * @param {string} chatId - WhatsApp chat ID
   * @param {string} role - 'user' or 'assistant'
   * @param {string} content - Message content
   */
  addMessage(chatId, role, content) {
    return new Promise((resolve, reject) => {
      const timestamp = Date.now();
      
      // Insert the new message
      const insertSQL = `
        INSERT INTO conversations (chat_id, role, content, timestamp)
        VALUES (?, ?, ?, ?)
      `;
      
      this.db.run(insertSQL, [chatId, role, content, timestamp], function(err) {
        if (err) {
          console.error('❌ Error adding message:', err.message);
          reject(err);
          return;
        }
        
        console.log(`💬 Added ${role} message to ${chatId} (ID: ${this.lastID})`);
        
        // Keep only the last N messages for this chat
        conversationManager.trimMessagesForChat(chatId)
          .then(() => resolve(this.lastID))
          .catch(reject);
      });
    });
  }

  /**
   * Trim messages to keep only the last N messages for a specific chat
   * @param {string} chatId - WhatsApp chat ID
   */
  trimMessagesForChat(chatId) {
    return new Promise((resolve, reject) => {
      // Get count of messages for this chat
      const countSQL = `SELECT COUNT(*) as count FROM conversations WHERE chat_id = ?`;
      
      this.db.get(countSQL, [chatId], (err, row) => {
        if (err) {
          console.error('❌ Error counting messages:', err.message);
          reject(err);
          return;
        }
        
        const messageCount = row.count;
        
        if (messageCount <= this.maxMessages) {
          resolve(); // No trimming needed
          return;
        }
        
        // Delete old messages, keeping only the latest ones
        const deleteSQL = `
          DELETE FROM conversations 
          WHERE chat_id = ? 
          AND id NOT IN (
            SELECT id FROM conversations 
            WHERE chat_id = ? 
            ORDER BY timestamp DESC 
            LIMIT ?
          )
        `;
        
        this.db.run(deleteSQL, [chatId, chatId, this.maxMessages], function(err) {
          if (err) {
            console.error('❌ Error trimming messages:', err.message);
            reject(err);
            return;
          }
          
          const deletedCount = messageCount - conversationManager.maxMessages;
          if (this.changes > 0) {
            console.log(`🧹 Trimmed ${deletedCount} old messages for ${chatId}`);
          }
          resolve();
        });
      });
    });
  }

  /**
   * Get conversation history for a user
   * @param {string} chatId - WhatsApp chat ID
   * @returns {Promise<Array>} - Array of message objects with role and content
   */
  getHistory(chatId) {
    return new Promise((resolve, reject) => {
      const selectSQL = `
        SELECT role, content, timestamp
        FROM conversations 
        WHERE chat_id = ? 
        ORDER BY timestamp ASC
        LIMIT ?
      `;
      
      this.db.all(selectSQL, [chatId, this.maxMessages], (err, rows) => {
        if (err) {
          console.error('❌ Error getting history:', err.message);
          reject(err);
          return;
        }
        
        // Return conversation history in the same format as before
        const history = rows.map(row => ({
          role: row.role,
          content: row.content
        }));
        
        resolve(history);
      });
    });
  }

  /**
   * Clear conversation history for a specific user
   * @param {string} chatId - WhatsApp chat ID
   * @returns {Promise<boolean>} - True if messages were deleted, false if none existed
   */
  clearSession(chatId) {
    return new Promise((resolve, reject) => {
      const deleteSQL = `DELETE FROM conversations WHERE chat_id = ?`;
      
      this.db.run(deleteSQL, [chatId], function(err) {
        if (err) {
          console.error('❌ Error clearing session:', err.message);
          reject(err);
          return;
        }
        
        const wasCleared = this.changes > 0;
        if (wasCleared) {
          console.log(`🗑️ Conversation session cleared for ${chatId} (${this.changes} messages deleted)`);
        }
        resolve(wasCleared);
      });
    });
  }

  /**
   * Clear all conversation history (for admin use)
   * @returns {Promise<number>} - Number of messages deleted
   */
  clearAllSessions() {
    return new Promise((resolve, reject) => {
      const deleteSQL = `DELETE FROM conversations`;
      
      this.db.run(deleteSQL, [], function(err) {
        if (err) {
          console.error('❌ Error clearing all sessions:', err.message);
          reject(err);
          return;
        }
        
        console.log(`🗑️ All conversation sessions cleared (${this.changes} messages deleted)`);
        resolve(this.changes);
      });
    });
  }

  /**
   * Get session statistics
   * @returns {Promise<Object>} - Statistics about conversations
   */
  getStats() {
    return new Promise((resolve, reject) => {
      const statsSQL = `
        SELECT 
          COUNT(DISTINCT chat_id) as activeSessions,
          COUNT(*) as totalMessages,
          AVG(messages_per_chat) as averageMessagesPerSession,
          MIN(oldest_timestamp) as oldestMessageTime,
          MAX(newest_timestamp) as newestMessageTime
        FROM (
          SELECT 
            chat_id,
            COUNT(*) as messages_per_chat,
            MIN(timestamp) as oldest_timestamp,
            MAX(timestamp) as newest_timestamp
          FROM conversations 
          GROUP BY chat_id
        )
      `;
      
      this.db.get(statsSQL, [], (err, row) => {
        if (err) {
          console.error('❌ Error getting stats:', err.message);
          reject(err);
          return;
        }
        
        const stats = {
          activeSessions: row.activeSessions || 0,
          totalMessages: row.totalMessages || 0,
          averageMessagesPerSession: row.averageMessagesPerSession ? parseFloat(row.averageMessagesPerSession).toFixed(1) : 0,
          oldestSessionAge: row.oldestMessageTime ? Date.now() - row.oldestMessageTime : 0,
          newestSessionAge: row.newestMessageTime ? Date.now() - row.newestMessageTime : 0
        };
        
        resolve(stats);
      });
    });
  }

  /**
   * Check if user has an active conversation (has any messages)
   * @param {string} chatId - WhatsApp chat ID
   * @returns {Promise<boolean>}
   */
  hasActiveSession(chatId) {
    return new Promise((resolve, reject) => {
      const countSQL = `SELECT COUNT(*) as count FROM conversations WHERE chat_id = ?`;
      
      this.db.get(countSQL, [chatId], (err, row) => {
        if (err) {
          console.error('❌ Error checking active session:', err.message);
          reject(err);
          return;
        }
        
        resolve(row.count > 0);
      });
    });
  }

  /**
   * Close database connection (for graceful shutdown)
   */
  close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            console.error('❌ Error closing database:', err.message);
            reject(err);
            return;
          }
          console.log('📁 Database connection closed');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

// Create global instance
const conversationManager = new ConversationManager();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🔄 Shutting down gracefully...');
  try {
    await conversationManager.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  console.log('\n🔄 Shutting down gracefully...');
  try {
    await conversationManager.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

module.exports = conversationManager;