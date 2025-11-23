/**
 * Message Type Cache
 * 
 * Tracks message types to identify different message categories in Green API getChatHistory.
 * Uses in-memory caches with TTL-based cleanup.
 * 
 * Message Types:
 * 1. Bot messages - sent by the bot via our API
 * 2. User outgoing messages - sent by user (not via bot)
 * 3. Commands - messages starting with "# " (for retry functionality)
 * 
 * Why this approach:
 * - Green API getChatHistory doesn't clearly mark message types
 * - We can track message IDs when we send/receive messages
 * - Webhooks provide context (incoming/outgoing)
 * - This avoids DB storage and provides accurate identification
 */

class MessageTypeCache {
  constructor() {
    // Map: chatId -> Map of messageId -> timestamp
    this.botMessages = new Map();      // Messages sent by bot
    this.userOutgoingMessages = new Map(); // Messages sent by user (outgoing)
    this.commands = new Map();         // Commands (for retry - stores minimal metadata)
    
    // TTL: 7 days (messages older than this are removed)
    this.TTL_MS = 7 * 24 * 60 * 60 * 1000;
    
    // Command metadata TTL: 30 days (longer for retry functionality)
    this.COMMAND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    
    // Cleanup interval: every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1000);
  }

  /**
   * Mark a message as sent by the bot
   * @param {string} chatId - Chat ID
   * @param {string} messageId - Message ID from Green API
   */
  markAsBotMessage(chatId, messageId) {
    if (!chatId || !messageId) return;
    
    if (!this.botMessages.has(chatId)) {
      this.botMessages.set(chatId, new Map());
    }
    
    this.botMessages.get(chatId).set(messageId, Date.now());
    console.log(`🤖 [MessageTypeCache] Marked message ${messageId} as bot message in ${chatId}`);
  }

  /**
   * Mark a message as sent by user (outgoing, not via bot)
   * @param {string} chatId - Chat ID
   * @param {string} messageId - Message ID from Green API
   */
  markAsUserOutgoing(chatId, messageId) {
    if (!chatId || !messageId) return;
    
    if (!this.userOutgoingMessages.has(chatId)) {
      this.userOutgoingMessages.set(chatId, new Map());
    }
    
    this.userOutgoingMessages.get(chatId).set(messageId, Date.now());
    console.log(`👤 [MessageTypeCache] Marked message ${messageId} as user outgoing in ${chatId}`);
  }

  /**
   * Save command metadata for retry functionality
   * @param {string} chatId - Chat ID
   * @param {string} messageId - Message ID from Green API
   * @param {Object} metadata - Command metadata (tool, args, prompt, etc.)
   */
  saveCommand(chatId, messageId, metadata) {
    if (!chatId || !messageId) return;
    
    if (!this.commands.has(chatId)) {
      this.commands.set(chatId, new Map());
    }
    
    const commandData = {
      ...metadata,
      timestamp: Date.now()
    };
    
    this.commands.get(chatId).set(messageId, commandData);
    console.log(`💾 [MessageTypeCache] Saved command ${messageId} for retry in ${chatId}`);
  }

  /**
   * Get last command for retry
   * @param {string} chatId - Chat ID
   * @returns {Object|null} Last command metadata or null
   */
  getLastCommand(chatId) {
    if (!chatId || !this.commands.has(chatId)) {
      return null;
    }
    
    const chatCommands = this.commands.get(chatId);
    if (chatCommands.size === 0) {
      return null;
    }
    
    // Get the most recent command (highest timestamp)
    let lastCommand = null;
    let latestTimestamp = 0;
    
    for (const [messageId, commandData] of chatCommands.entries()) {
      if (commandData.timestamp > latestTimestamp) {
        latestTimestamp = commandData.timestamp;
        lastCommand = {
          messageId,
          ...commandData
        };
      }
    }
    
    return lastCommand;
  }

  /**
   * Check if a message is from the bot
   * @param {string} chatId - Chat ID
   * @param {string} messageId - Message ID to check
   * @returns {boolean} True if message is from bot
   */
  isBotMessage(chatId, messageId) {
    if (!chatId || !messageId) return false;
    
    const chatCache = this.botMessages.get(chatId);
    return chatCache ? chatCache.has(messageId) : false;
  }

  /**
   * Check if a message is user outgoing (not via bot)
   * @param {string} chatId - Chat ID
   * @param {string} messageId - Message ID to check
   * @returns {boolean} True if message is user outgoing
   */
  isUserOutgoing(chatId, messageId) {
    if (!chatId || !messageId) return false;
    
    const chatCache = this.userOutgoingMessages.get(chatId);
    return chatCache ? chatCache.has(messageId) : false;
  }

  /**
   * Check if a message is a command (by text content)
   * @param {string} text - Message text
   * @returns {boolean} True if message is a command
   */
  isCommand(text) {
    if (!text || typeof text !== 'string') return false;
    return /^#\s+/.test(text.trim());
  }

  /**
   * Get message type
   * @param {string} chatId - Chat ID
   * @param {string} messageId - Message ID
   * @param {string} text - Message text
   * @returns {string} Message type: 'bot' | 'user_outgoing' | 'command' | 'user_incoming'
   */
  getMessageType(chatId, messageId, text) {
    if (this.isBotMessage(chatId, messageId)) {
      return 'bot';
    }
    
    if (this.isUserOutgoing(chatId, messageId)) {
      return this.isCommand(text) ? 'command' : 'user_outgoing';
    }
    
    // If it's a command by text but not in cache, it's still a command
    if (this.isCommand(text)) {
      return 'command';
    }
    
    // Default: incoming user message
    return 'user_incoming';
  }

  /**
   * Cleanup old entries (older than TTL)
   */
  cleanup() {
    const now = Date.now();
    let totalRemoved = 0;
    
    // Cleanup bot messages
    for (const [chatId, chatCache] of this.botMessages.entries()) {
      for (const [messageId, timestamp] of chatCache.entries()) {
        if (now - timestamp > this.TTL_MS) {
          chatCache.delete(messageId);
          totalRemoved++;
        }
      }
      if (chatCache.size === 0) {
        this.botMessages.delete(chatId);
      }
    }
    
    // Cleanup user outgoing messages
    for (const [chatId, chatCache] of this.userOutgoingMessages.entries()) {
      for (const [messageId, timestamp] of chatCache.entries()) {
        if (now - timestamp > this.TTL_MS) {
          chatCache.delete(messageId);
          totalRemoved++;
        }
      }
      if (chatCache.size === 0) {
        this.userOutgoingMessages.delete(chatId);
      }
    }
    
    // Cleanup commands (longer TTL)
    for (const [chatId, chatCache] of this.commands.entries()) {
      for (const [messageId, commandData] of chatCache.entries()) {
        if (now - commandData.timestamp > this.COMMAND_TTL_MS) {
          chatCache.delete(messageId);
          totalRemoved++;
        }
      }
      if (chatCache.size === 0) {
        this.commands.delete(chatId);
      }
    }
    
    if (totalRemoved > 0) {
      console.log(`🧹 [MessageTypeCache] Cleaned up ${totalRemoved} old message IDs`);
    }
  }

  /**
   * Get cache stats (for debugging)
   */
  getStats() {
    let botTotal = 0, userOutgoingTotal = 0, commandsTotal = 0;
    
    for (const chatCache of this.botMessages.values()) {
      botTotal += chatCache.size;
    }
    for (const chatCache of this.userOutgoingMessages.values()) {
      userOutgoingTotal += chatCache.size;
    }
    for (const chatCache of this.commands.values()) {
      commandsTotal += chatCache.size;
    }
    
    return {
      totalChats: Math.max(
        this.botMessages.size,
        this.userOutgoingMessages.size,
        this.commands.size
      ),
      botMessages: botTotal,
      userOutgoingMessages: userOutgoingTotal,
      commands: commandsTotal
    };
  }
}

// Export singleton instance
module.exports = new MessageTypeCache();

