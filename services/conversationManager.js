/**
 * Conversation Manager
 * Manages user conversation sessions with context memory
 * Optimized for memory usage and performance
 */

class ConversationManager {
  constructor() {
    this.sessions = new Map();
    this.maxMessages = 10; // Keep only last 10 messages per user
    this.sessionTTL = 30 * 60 * 1000; // 30 minutes session timeout
    this.cleanupInterval = 5 * 60 * 1000; // Cleanup every 5 minutes
    
    // Start periodic cleanup
    this.startCleanupTimer();
    
    console.log('💭 ConversationManager initialized');
    console.log(`📝 Max messages per session: ${this.maxMessages}`);
    console.log(`⏰ Session TTL: ${this.sessionTTL / 60000} minutes`);
  }

  /**
   * Add a message to user's conversation history
   * @param {string} chatId - WhatsApp chat ID
   * @param {string} role - 'user' or 'assistant'
   * @param {string} content - Message content
   */
  addMessage(chatId, role, content) {
    if (!this.sessions.has(chatId)) {
      this.sessions.set(chatId, {
        messages: [],
        lastActivity: Date.now(),
        createdAt: Date.now()
      });
      console.log(`💭 New conversation session created for ${chatId}`);
    }

    const session = this.sessions.get(chatId);
    
    // Add the new message
    session.messages.push({
      role: role,
      content: content,
      timestamp: Date.now()
    });
    
    // Update last activity
    session.lastActivity = Date.now();

    // Keep only the last N messages (memory optimization)
    if (session.messages.length > this.maxMessages) {
      const removedCount = session.messages.length - this.maxMessages;
      session.messages = session.messages.slice(-this.maxMessages);
      console.log(`🧹 Trimmed ${removedCount} old messages for ${chatId}`);
    }

    console.log(`💬 Added ${role} message to ${chatId} (${session.messages.length}/${this.maxMessages})`);
  }

  /**
   * Get conversation history for a user
   * @param {string} chatId - WhatsApp chat ID
   * @returns {Array} - Array of message objects with role and content
   */
  getHistory(chatId) {
    const session = this.sessions.get(chatId);
    
    if (!session) {
      return [];
    }

    // Check if session expired
    if (Date.now() - session.lastActivity > this.sessionTTL) {
      console.log(`⏰ Session expired for ${chatId}, clearing history`);
      this.sessions.delete(chatId);
      return [];
    }

    // Return conversation history in OpenAI format
    return session.messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  }

  /**
   * Clear conversation history for a specific user
   * @param {string} chatId - WhatsApp chat ID
   */
  clearSession(chatId) {
    if (this.sessions.has(chatId)) {
      this.sessions.delete(chatId);
      console.log(`🗑️ Conversation session cleared for ${chatId}`);
      return true;
    }
    return false;
  }

  /**
   * Get session statistics
   * @returns {Object} - Statistics about active sessions
   */
  getStats() {
    const activeSessions = this.sessions.size;
    let totalMessages = 0;
    let oldestSession = null;
    let newestSession = null;

    for (const [chatId, session] of this.sessions) {
      totalMessages += session.messages.length;
      
      if (!oldestSession || session.createdAt < oldestSession.createdAt) {
        oldestSession = { chatId, ...session };
      }
      
      if (!newestSession || session.createdAt > newestSession.createdAt) {
        newestSession = { chatId, ...session };
      }
    }

    return {
      activeSessions,
      totalMessages,
      averageMessagesPerSession: activeSessions > 0 ? (totalMessages / activeSessions).toFixed(1) : 0,
      oldestSessionAge: oldestSession ? Date.now() - oldestSession.createdAt : 0,
      newestSessionAge: newestSession ? Date.now() - newestSession.createdAt : 0
    };
  }

  /**
   * Start periodic cleanup of expired sessions
   */
  startCleanupTimer() {
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, this.cleanupInterval);
  }

  /**
   * Clean up expired sessions (memory optimization)
   */
  cleanupExpiredSessions() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [chatId, session] of this.sessions) {
      if (now - session.lastActivity > this.sessionTTL) {
        this.sessions.delete(chatId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} expired sessions`);
      const stats = this.getStats();
      console.log(`📊 Active sessions: ${stats.activeSessions}, Total messages: ${stats.totalMessages}`);
    }
  }

  /**
   * Check if user has an active conversation
   * @param {string} chatId - WhatsApp chat ID
   * @returns {boolean}
   */
  hasActiveSession(chatId) {
    const session = this.sessions.get(chatId);
    if (!session) return false;
    
    return (Date.now() - session.lastActivity) <= this.sessionTTL;
  }
}

// Create global instance
const conversationManager = new ConversationManager();

module.exports = conversationManager;
