/**
 * Bot Message Cache
 * 
 * Tracks bot message IDs to identify bot messages in Green API getChatHistory.
 * Uses a simple in-memory Set with TTL-based cleanup.
 * 
 * Why this approach:
 * - Green API getChatHistory doesn't clearly mark bot messages
 * - We can track message IDs when we send messages via our API
 * - Webhook 'outgoingMessageReceived' confirms messages we sent
 * - This avoids heuristic detection and provides accurate identification
 */

class BotMessageCache {
  constructor() {
    // Map: chatId -> Set of message IDs
    this.cache = new Map();
    
    // TTL: 7 days (messages older than this are removed)
    this.TTL_MS = 7 * 24 * 60 * 60 * 1000;
    
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
    
    if (!this.cache.has(chatId)) {
      this.cache.set(chatId, new Map());
    }
    
    const chatCache = this.cache.get(chatId);
    chatCache.set(messageId, Date.now());
    
    console.log(`🤖 [BotMessageCache] Marked message ${messageId} as bot message in ${chatId}`);
  }

  /**
   * Check if a message is from the bot
   * @param {string} chatId - Chat ID
   * @param {string} messageId - Message ID to check
   * @returns {boolean} True if message is from bot
   */
  isBotMessage(chatId, messageId) {
    if (!chatId || !messageId) return false;
    
    const chatCache = this.cache.get(chatId);
    if (!chatCache) return false;
    
    return chatCache.has(messageId);
  }

  /**
   * Cleanup old entries (older than TTL)
   */
  cleanup() {
    const now = Date.now();
    let totalRemoved = 0;
    
    for (const [chatId, chatCache] of this.cache.entries()) {
      for (const [messageId, timestamp] of chatCache.entries()) {
        if (now - timestamp > this.TTL_MS) {
          chatCache.delete(messageId);
          totalRemoved++;
        }
      }
      
      // Remove empty chat caches
      if (chatCache.size === 0) {
        this.cache.delete(chatId);
      }
    }
    
    if (totalRemoved > 0) {
      console.log(`🧹 [BotMessageCache] Cleaned up ${totalRemoved} old bot message IDs`);
    }
  }

  /**
   * Get cache stats (for debugging)
   */
  getStats() {
    let totalMessages = 0;
    for (const chatCache of this.cache.values()) {
      totalMessages += chatCache.size;
    }
    
    return {
      totalChats: this.cache.size,
      totalMessages: totalMessages
    };
  }
}

// Export singleton instance
module.exports = new BotMessageCache();

