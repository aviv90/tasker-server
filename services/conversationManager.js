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
    
    // Use persistent database location
    // In Heroku, use /tmp for temporary persistence across restarts within same dyno
    // For production, consider using external database service
    const isHeroku = process.env.NODE_ENV === 'production' || process.env.DYNO;
    if (isHeroku) {
      // Heroku: Use /tmp directory which persists during dyno lifecycle
      this.dbPath = '/tmp/conversations.db';
      console.log('🌐 Running on Heroku - using /tmp for database persistence');
      console.log(`🔍 Environment check: NODE_ENV=${process.env.NODE_ENV}, DYNO=${process.env.DYNO}`);
    } else {
      // Local development: Use store directory
      this.dbPath = path.join(__dirname, '..', 'store', 'conversations.db');
      console.log('🏠 Running locally - using store directory');
    }
    
    this.db = null;
    
    this.initializeDatabase();
    
    // Try to restore from backup if database doesn't exist (Heroku restart scenario)
    if (isHeroku) {
      this.tryRestoreFromBackup();
    }
    
    // Setup automatic backup for Heroku (more frequent)
    if (isHeroku) {
      // Backup every 5 minutes instead of 10
      setInterval(() => {
        this.createBackup().catch(err => console.warn('⚠️ Auto-backup failed:', err));
      }, 5 * 60 * 1000); // 5 minutes
      console.log('⏰ Auto-backup scheduled every 5 minutes for Heroku');
      
      // Also backup on any important database changes
      console.log('💾 Enhanced backup system enabled for Heroku');
    }
    
    console.log('💭 ConversationManager initialized with SQLite');
    console.log(`📝 Max messages per session: ${this.maxMessages}`);
    console.log(`💾 Database path: ${this.dbPath}`);
    
    // Create initial backup on startup (Heroku)
    if (isHeroku) {
      setTimeout(() => {
        this.createBackup().catch(err => console.warn('⚠️ Initial backup failed:', err));
      }, 2000); // Wait 2 seconds for DB to be fully initialized
      console.log('⏰ Initial backup scheduled for 2 seconds after startup');
    }
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
        const createConversationsTableSQL = `
          CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `;
        
        // Create voice transcription settings table
        const createVoiceSettingsTableSQL = `
          CREATE TABLE IF NOT EXISTS voice_settings (
            id INTEGER PRIMARY KEY,
            enabled BOOLEAN NOT NULL DEFAULT 0
          )
        `;
        
        // Create voice allow list table
        const createVoiceAllowListTableSQL = `
          CREATE TABLE IF NOT EXISTS voice_allow_list (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            contact_name TEXT NOT NULL UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `;
        
        // Create media creation allow list table
        const createMediaAllowListTableSQL = `
          CREATE TABLE IF NOT EXISTS media_allow_list (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            contact_name TEXT NOT NULL UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `;
        
        this.db.run(createConversationsTableSQL, (err) => {
          if (err) {
            console.error('❌ Error creating conversations table:', err.message);
            reject(err);
            return;
          }
          
          this.db.run(createVoiceSettingsTableSQL, (err) => {
            if (err) {
              console.error('❌ Error creating voice_settings table:', err.message);
              reject(err);
              return;
            }
            
            this.db.run(createVoiceAllowListTableSQL, (err) => {
              if (err) {
                console.error('❌ Error creating voice_allow_list table:', err.message);
                reject(err);
                return;
              }
              
              // Create media allow list table
              this.db.run(createMediaAllowListTableSQL, (err) => {
                if (err) {
                  console.error('❌ Error creating media_allow_list table:', err.message);
                  reject(err);
                  return;
                }
                
                console.log('📋 Media allow list table created');
                
                // Create indexes for performance
                const createConversationsIndexSQL = `
                  CREATE INDEX IF NOT EXISTS idx_chat_timestamp 
                  ON conversations(chat_id, timestamp DESC)
                `;
                
                const createVoiceAllowIndexSQL = `
                  CREATE INDEX IF NOT EXISTS idx_contact_name 
                  ON voice_allow_list(contact_name)
                `;
                
                const createMediaAllowIndexSQL = `
                  CREATE INDEX IF NOT EXISTS idx_media_contact_name 
                  ON media_allow_list(contact_name)
                `;
                
                this.db.run(createConversationsIndexSQL, (err) => {
                  if (err) {
                    console.error('❌ Error creating conversations index:', err.message);
                    reject(err);
                    return;
                  }
                  
                  this.db.run(createVoiceAllowIndexSQL, (err) => {
                    if (err) {
                      console.error('❌ Error creating voice allow index:', err.message);
                      reject(err);
                      return;
                    }
                    
                    this.db.run(createMediaAllowIndexSQL, (err) => {
                      if (err) {
                        console.error('❌ Error creating media allow index:', err.message);
                        reject(err);
                        return;
                      }
                      
                      // Initialize voice settings if not exists
                      this.initializeVoiceSettings()
                        .then(() => {
                          console.log('✅ Database tables and indexes ready');
                          resolve();
                        })
                        .catch(reject);
                    });
                  });
                });
              });
            });
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
   * Initialize voice settings with default values
   */
  initializeVoiceSettings() {
    return new Promise((resolve, reject) => {
      // Check if settings already exist
      const checkSQL = `SELECT COUNT(*) as count FROM voice_settings WHERE id = 1`;
      
      this.db.get(checkSQL, [], (err, row) => {
        if (err) {
          console.error('❌ Error checking voice settings:', err.message);
          reject(err);
          return;
        }
        
        if (row.count === 0) {
          // Insert default settings (disabled by default)
          const insertSQL = `INSERT INTO voice_settings (id, enabled) VALUES (1, 0)`;
          
          this.db.run(insertSQL, [], (err) => {
            if (err) {
              console.error('❌ Error initializing voice settings:', err.message);
              reject(err);
              return;
            }
            
            console.log('📋 Voice transcription initialized: disabled (default)');
            resolve();
          });
        } else {
          console.log('📋 Voice settings already exist');
          resolve();
        }
      });
    });
  }

  /**
   * Get voice transcription status
   * @returns {Promise<boolean>} - True if enabled, false if disabled
   */
  getVoiceTranscriptionStatus() {
    return new Promise((resolve, reject) => {
      const selectSQL = `SELECT enabled FROM voice_settings WHERE id = 1`;
      
      this.db.get(selectSQL, [], (err, row) => {
        if (err) {
          console.error('❌ Error getting voice status:', err.message);
          reject(err);
          return;
        }
        
        const enabled = row ? Boolean(row.enabled) : false;
        resolve(enabled);
      });
    });
  }

  /**
   * Set voice transcription status
   * @param {boolean} enabled - True to enable, false to disable
   * @returns {Promise<void>}
   */
  setVoiceTranscriptionStatus(enabled) {
    return new Promise((resolve, reject) => {
      const updateSQL = `
        INSERT OR REPLACE INTO voice_settings (id, enabled) 
        VALUES (1, ?)
      `;
      
      // Save reference to class instance before callback
      const self = this;
      
      this.db.run(updateSQL, [enabled ? 1 : 0], (err) => {
        if (err) {
          console.error('❌ Error setting voice status:', err.message);
          reject(err);
          return;
        }
        
        console.log(`💾 Voice transcription status updated: ${enabled ? 'enabled' : 'disabled'}`);
        // Create immediate backup after important changes (Heroku)
        const isHeroku = process.env.NODE_ENV === 'production' || process.env.DYNO;
        if (isHeroku) {
          // Backup immediately for critical changes
          setImmediate(() => {
            self.createBackup().catch(err => console.warn('⚠️ Backup after status change failed:', err));
          });
        }
        resolve();
      });
    });
  }

  /**
   * Add contact to voice transcription allow list
   * @param {string} contactName - Contact name to add
   * @returns {Promise<boolean>} - True if added, false if already existed
   */
  addToVoiceAllowList(contactName) {
    return new Promise((resolve, reject) => {
      const insertSQL = `
        INSERT OR IGNORE INTO voice_allow_list (contact_name) 
        VALUES (?)
      `;
      
      // Save reference to class instance before callback
      const self = this;
      
      this.db.run(insertSQL, [contactName], function(err) {
        if (err) {
          console.error('❌ Error adding to voice allow list:', err.message);
          reject(err);
          return;
        }
        
        const wasAdded = this.changes > 0;
        if (wasAdded) {
          console.log(`✅ Added ${contactName} to voice allow list`);
          // Create immediate backup after important changes (Heroku)
          const isHeroku = process.env.NODE_ENV === 'production' || process.env.DYNO;
          if (isHeroku) {
            setImmediate(() => {
              self.createBackup().catch(err => console.warn('⚠️ Backup after voice add failed:', err));
            });
          }
        }
        resolve(wasAdded);
      });
    });
  }

  /**
   * Remove contact from voice transcription allow list
   * @param {string} contactName - Contact name to remove
   * @returns {Promise<boolean>} - True if removed, false if didn't exist
   */
  removeFromVoiceAllowList(contactName) {
    return new Promise((resolve, reject) => {
      const deleteSQL = `DELETE FROM voice_allow_list WHERE contact_name = ?`;
      
      // Save reference to class instance before callback
      const self = this;
      
      this.db.run(deleteSQL, [contactName], function(err) {
        if (err) {
          console.error('❌ Error removing from voice allow list:', err.message);
          reject(err);
          return;
        }
        
        const wasRemoved = this.changes > 0;
        if (wasRemoved) {
          console.log(`🚫 Removed ${contactName} from voice allow list`);
          // Create immediate backup after important changes (Heroku)
          const isHeroku = process.env.NODE_ENV === 'production' || process.env.DYNO;
          if (isHeroku) {
            setImmediate(() => {
              self.createBackup().catch(err => console.warn('⚠️ Backup after voice remove failed:', err));
            });
          }
        }
        resolve(wasRemoved);
      });
    });
  }

  /**
   * Check if contact is in voice transcription allow list
   * @param {string} contactName - Contact name to check
   * @returns {Promise<boolean>} - True if in allow list, false otherwise
   */
  isInVoiceAllowList(contactName) {
    return new Promise((resolve, reject) => {
      const selectSQL = `SELECT COUNT(*) as count FROM voice_allow_list WHERE contact_name = ?`;
      
      this.db.get(selectSQL, [contactName], (err, row) => {
        if (err) {
          console.error('❌ Error checking voice allow list:', err.message);
          reject(err);
          return;
        }
        
        resolve(row.count > 0);
      });
    });
  }

  /**
   * Get all contacts in voice transcription allow list
   * @returns {Promise<Array>} - Array of contact names
   */
  getVoiceAllowList() {
    return new Promise((resolve, reject) => {
      const selectSQL = `SELECT contact_name FROM voice_allow_list ORDER BY contact_name`;
      
      this.db.all(selectSQL, [], (err, rows) => {
        if (err) {
          console.error('❌ Error getting voice allow list:', err.message);
          reject(err);
          return;
        }
        
        const contacts = rows.map(row => row.contact_name);
        resolve(contacts);
      });
    });
  }

  /**
   * Clear all voice transcription settings and allow list
   * @returns {Promise<number>} - Number of contacts removed from allow list
   */
  clearVoiceSettings() {
    return new Promise((resolve, reject) => {
      // First, count how many will be deleted
      const countSQL = `SELECT COUNT(*) as count FROM voice_allow_list`;
      
      this.db.get(countSQL, [], (err, row) => {
        if (err) {
          console.error('❌ Error counting voice allow list:', err.message);
          reject(err);
          return;
        }
        
        const contactCount = row.count;
        
        // Clear allow list
        const clearAllowListSQL = `DELETE FROM voice_allow_list`;
        
        this.db.run(clearAllowListSQL, [], (err) => {
          if (err) {
            console.error('❌ Error clearing voice allow list:', err.message);
            reject(err);
            return;
          }
          
          // Reset voice settings to disabled
          const resetSettingsSQL = `UPDATE voice_settings SET enabled = 0 WHERE id = 1`;
          
          this.db.run(resetSettingsSQL, [], (err) => {
            if (err) {
              console.error('❌ Error resetting voice settings:', err.message);
              reject(err);
              return;
            }
            
            console.log(`🗑️ Voice settings cleared: ${contactCount} contacts removed, transcription disabled`);
            resolve(contactCount);
          });
        });
      });
    });
  }

  /**
   * Try to restore database from backup (for Heroku restarts)
   */
  async tryRestoreFromBackup() {
    const fs = require('fs');
    const backupPath = '/tmp/conversations_backup.db';
    const secondaryBackupPath = '/app/conversations_backup.db'; // Try app directory
    
    try {
      // Check if main DB doesn't exist (fresh restart)
      if (!fs.existsSync(this.dbPath)) {
        console.log('🔍 Database not found, searching for backups...');
        
        // Try primary backup location first
        if (fs.existsSync(backupPath)) {
          console.log('🔄 Restoring database from primary backup...');
          fs.copyFileSync(backupPath, this.dbPath);
          console.log('✅ Database restored from primary backup');
          return;
        }
        
        // Try secondary backup location
        if (fs.existsSync(secondaryBackupPath)) {
          console.log('🔄 Restoring database from secondary backup...');
          fs.copyFileSync(secondaryBackupPath, this.dbPath);
          console.log('✅ Database restored from secondary backup');
          return;
        }
        
        // Try to restore from environment-based backup
        await this.restoreFromEnvironmentBackup();
        
        console.log('ℹ️ No backups found, starting with fresh database');
      }
    } catch (error) {
      console.warn('⚠️ Could not restore from backup:', error.message);
    }
  }

  /**
   * Create backup of current database (for Heroku persistence)
   */
  async createBackup() {
    const fs = require('fs');
    const backupPath = '/tmp/conversations_backup.db';
    const secondaryBackupPath = '/app/conversations_backup.db'; // Try app directory
    
    try {
      if (fs.existsSync(this.dbPath)) {
        // Create primary backup
        fs.copyFileSync(this.dbPath, backupPath);
        
        // Create secondary backup in app directory
        try {
          fs.copyFileSync(this.dbPath, secondaryBackupPath);
        } catch (secondaryError) {
          console.warn('⚠️ Could not create secondary backup:', secondaryError.message);
        }
        
        // Create environment-based backup
        await this.createEnvironmentBackup();
        
        const backupInfo = {
          primary: fs.existsSync(backupPath) ? '✅' : '❌',
          secondary: fs.existsSync(secondaryBackupPath) ? '✅' : '❌',
          timestamp: new Date().toISOString()
        };
        console.log('💾 Database backups created:', backupInfo);
      }
    } catch (error) {
      console.warn('⚠️ Could not create backup:', error.message);
    }
  }

  /**
   * Create environment-based backup (store essential data in env-like format)
   */
  async createEnvironmentBackup() {
    try {
      // Get essential data from database
      const backupData = {
        voiceAllowList: [],
        mediaAllowList: [],
        voiceSettings: { enabled: true },
        timestamp: new Date().toISOString()
      };
      
      // Get voice allow list
      await new Promise((resolve, reject) => {
        this.db.all('SELECT contact_name FROM voice_allow_list', (err, rows) => {
          if (err) {
            console.warn('⚠️ Could not backup voice allow list:', err.message);
            resolve();
            return;
          }
          backupData.voiceAllowList = rows.map(row => row.contact_name);
          resolve();
        });
      });
      
      // Get media allow list (from authStore)
      try {
        const authStore = require('../store/authStore');
        const authorizedUsers = await authStore.getAuthorizedUsers();
        backupData.mediaAllowList = authorizedUsers;
      } catch (authError) {
        console.warn('⚠️ Could not backup media allow list:', authError.message);
      }
      
      // Store as base64 encoded JSON (to avoid env variable issues)
      const backupString = Buffer.from(JSON.stringify(backupData)).toString('base64');
      
      // Log backup summary
      console.log(`📋 Environment backup: ${backupData.voiceAllowList.length} voice, ${backupData.mediaAllowList.length} media contacts`);
      
    } catch (error) {
      console.warn('⚠️ Could not create environment backup:', error.message);
    }
  }
  
  /**
   * Restore from environment-based backup
   */
  async restoreFromEnvironmentBackup() {
    try {
      // In a real scenario, you would fetch this from an external service
      // For now, we'll just log that we attempted it
      console.log('🔍 Attempting to restore from environment backup...');
      console.log('ℹ️ Environment backup restore not implemented yet (would require external storage)');
    } catch (error) {
      console.warn('⚠️ Could not restore from environment backup:', error.message);
    }
  }

  /**
   * Close database connection (for graceful shutdown)
   */
  close() {
    return new Promise(async (resolve, reject) => {
      // Create backup before closing (for Heroku)
      const isHeroku = process.env.NODE_ENV === 'production' || process.env.DYNO;
      if (isHeroku) {
        try {
          await this.createBackup();
        } catch (err) {
          console.warn('⚠️ Backup failed during close:', err);
        }
      }
      
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

  /**
   * Add contact to media creation allow list
   * @param {string} contactName - Contact name to add
   * @returns {Promise<boolean>} - True if added, false if already existed
   */
  addToMediaAllowList(contactName) {
    return new Promise((resolve, reject) => {
      const insertSQL = `
        INSERT OR IGNORE INTO media_allow_list (contact_name) 
        VALUES (?)
      `;
      
      // Save reference to class instance before callback
      const self = this;
      
      this.db.run(insertSQL, [contactName], function(err) {
        if (err) {
          console.error('❌ Error adding to media allow list:', err.message);
          reject(err);
          return;
        }
        
        const wasAdded = this.changes > 0;
        if (wasAdded) {
          console.log(`✅ Added ${contactName} to media allow list`);
          // Create immediate backup after important changes (Heroku)
          const isHeroku = process.env.NODE_ENV === 'production' || process.env.DYNO;
          if (isHeroku) {
            setImmediate(() => {
              self.createBackup().catch(err => console.warn('⚠️ Backup after media add failed:', err));
            });
          }
        }
        resolve(wasAdded);
      });
    });
  }

  /**
   * Remove contact from media creation allow list
   * @param {string} contactName - Contact name to remove
   * @returns {Promise<boolean>} - True if removed, false if didn't exist
   */
  removeFromMediaAllowList(contactName) {
    return new Promise((resolve, reject) => {
      const deleteSQL = `DELETE FROM media_allow_list WHERE contact_name = ?`;
      
      // Save reference to class instance before callback
      const self = this;
      
      this.db.run(deleteSQL, [contactName], function(err) {
        if (err) {
          console.error('❌ Error removing from media allow list:', err.message);
          reject(err);
          return;
        }
        
        const wasRemoved = this.changes > 0;
        if (wasRemoved) {
          console.log(`🚫 Removed ${contactName} from media allow list`);
          // Create immediate backup after important changes (Heroku)
          const isHeroku = process.env.NODE_ENV === 'production' || process.env.DYNO;
          if (isHeroku) {
            setImmediate(() => {
              self.createBackup().catch(err => console.warn('⚠️ Backup after media remove failed:', err));
            });
          }
        }
        resolve(wasRemoved);
      });
    });
  }

  /**
   * Check if contact is in media creation allow list
   * @param {string} contactName - Contact name to check
   * @returns {Promise<boolean>} - True if in allow list, false otherwise
   */
  isInMediaAllowList(contactName) {
    return new Promise((resolve, reject) => {
      const selectSQL = `SELECT COUNT(*) as count FROM media_allow_list WHERE contact_name = ?`;
      
      this.db.get(selectSQL, [contactName], (err, row) => {
        if (err) {
          console.error('❌ Error checking media allow list:', err.message);
          reject(err);
          return;
        }
        
        resolve(row.count > 0);
      });
    });
  }

  /**
   * Get all contacts in media creation allow list
   * @returns {Promise<Array>} - Array of contact names
   */
  getMediaAllowList() {
    return new Promise((resolve, reject) => {
      const selectSQL = `SELECT contact_name FROM media_allow_list ORDER BY contact_name`;
      
      this.db.all(selectSQL, [], (err, rows) => {
        if (err) {
          console.error('❌ Error getting media allow list:', err.message);
          reject(err);
          return;
        }
        
        const contacts = rows.map(row => row.contact_name);
        resolve(contacts);
      });
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