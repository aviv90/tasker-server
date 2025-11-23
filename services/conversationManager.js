const DatabaseManager = require('./conversation/database');
const MessagesManager = require('./conversation/messages'); // @deprecated - kept for backward compatibility
const AllowListsManager = require('./conversation/allowLists');
const ContactsManager = require('./conversation/contacts');
const CommandsManager = require('./conversation/commands');
const MessageTypesManager = require('./conversation/messageTypes');
const TasksManager = require('./conversation/tasks');
const AgentContextManager = require('./conversation/agentContext');
const SummariesManager = require('./conversation/summaries');
const logger = require('../utils/logger');

class ConversationManager {
  constructor() {
    this.maxMessages = 50; // Keep last 50 messages per chat
    this.pool = null;
    this.isInitialized = false;
    this.cleanupTimeoutHandle = null;
    this.cleanupIntervalHandle = null;
    
    // Initialize managers
    this.databaseManager = new DatabaseManager(this);
    this.messagesManager = new MessagesManager(this);
    this.allowListsManager = new AllowListsManager(this);
    this.contactsManager = new ContactsManager(this);
    this.commandsManager = new CommandsManager(this);
    this.messageTypesManager = new MessageTypesManager(this);
    this.tasksManager = new TasksManager(this);
    this.agentContextManager = new AgentContextManager(this);
    this.summariesManager = new SummariesManager(this);
    
    console.log('💭 ConversationManager initializing with PostgreSQL...');
    this.databaseManager.initializeDatabase();
  }

  // ═══════════════════ DATABASE INITIALIZATION ═══════════════════
  
  async initializeDatabase(attempt = 1) {
    return this.databaseManager.initializeDatabase(attempt);
  }

  // ═══════════════════ MESSAGES ═══════════════════
  //
  // @deprecated These methods are deprecated. Messages are no longer stored in DB
  // to avoid duplication. All messages are retrieved from Green API getChatHistory
  // when needed. Use chatHistoryService.getChatHistory() instead.
  //
  // These methods are kept for backward compatibility only (fallback scenarios).

  async addMessage(chatId, role, content, metadata = {}) {
    logger.warn('⚠️ [DEPRECATED] conversationManager.addMessage() is deprecated. Messages are retrieved from Green API.');
    return this.messagesManager.addMessage(chatId, role, content, metadata);
  }

  async trimMessagesForChat(chatId) {
    return this.messagesManager.trimMessagesForChat(chatId);
  }

  async getConversationHistory(chatId) {
    logger.warn('⚠️ [DEPRECATED] conversationManager.getConversationHistory() is deprecated. Use chatHistoryService.getChatHistory() instead.');
    return this.messagesManager.getConversationHistory(chatId);
  }

  // ═══════════════════ VOICE SETTINGS & ALLOW LISTS ═══════════════════

  async setVoiceTranscriptionStatus(enabled) {
    return this.allowListsManager.setVoiceTranscriptionStatus(enabled);
  }

  async getVoiceTranscriptionStatus() {
    return this.allowListsManager.getVoiceTranscriptionStatus();
  }

  async addToVoiceAllowList(contactName) {
    return this.allowListsManager.addToVoiceAllowList(contactName);
  }

  async removeFromVoiceAllowList(contactName) {
    return this.allowListsManager.removeFromVoiceAllowList(contactName);
  }

  async getVoiceAllowList() {
    return this.allowListsManager.getVoiceAllowList();
  }

  async isInVoiceAllowList(contactName) {
    return this.allowListsManager.isInVoiceAllowList(contactName);
  }

  async isAuthorizedForVoiceTranscription(senderData) {
    return this.allowListsManager.isAuthorizedForVoiceTranscription(senderData);
  }

  async addToMediaAllowList(contactName) {
    return this.allowListsManager.addToMediaAllowList(contactName);
  }

  async removeFromMediaAllowList(contactName) {
    return this.allowListsManager.removeFromMediaAllowList(contactName);
  }

  async getMediaAllowList() {
    return this.allowListsManager.getMediaAllowList();
  }

  async addToGroupCreationAllowList(contactName) {
    return this.allowListsManager.addToGroupCreationAllowList(contactName);
  }

  async removeFromGroupCreationAllowList(contactName) {
    return this.allowListsManager.removeFromGroupCreationAllowList(contactName);
  }

  async getGroupCreationAllowList() {
    return this.allowListsManager.getGroupCreationAllowList();
  }

  async isInGroupCreationAllowList(contactName) {
    return this.allowListsManager.isInGroupCreationAllowList(contactName);
  }

  async getDatabaseStats() {
    return this.allowListsManager.getDatabaseStats();
  }

  async clearAllConversations() {
    return this.allowListsManager.clearAllConversations();
  }

  // ═══════════════════ CONTACTS ═══════════════════

  async syncContacts(contactsArray) {
    return this.contactsManager.syncContacts(contactsArray);
  }

  async getAllContacts() {
    return this.contactsManager.getAllContacts();
  }

  async getContactsByType(type) {
    return this.contactsManager.getContactsByType(type);
  }

  // ═══════════════════ LAST COMMANDS (RETRY) ═══════════════════

  async saveCommand(chatId, messageId, metadata) {
    return this.commandsManager.saveCommand(chatId, messageId, metadata);
  }

  async getLastCommand(chatId) {
    return this.commandsManager.getLastCommand(chatId);
  }

  // Backward compatibility
  async saveLastCommand(chatId, tool, args, options = {}) {
    return this.commandsManager.saveLastCommand(chatId, tool, args, options);
  }

  // ═══════════════════ TASKS (ASYNC API) ═══════════════════

  async saveTask(taskId, status, data = {}) {
    return this.tasksManager.saveTask(taskId, status, data);
  }

  async getTask(taskId) {
    return this.tasksManager.getTask(taskId);
  }

  // ═══════════════════ AGENT CONTEXT ═══════════════════

  async saveAgentContext(chatId, context) {
    return this.agentContextManager.saveAgentContext(chatId, context);
  }

  async getAgentContext(chatId) {
    return this.agentContextManager.getAgentContext(chatId);
  }

  async clearAgentContext(chatId) {
    return this.agentContextManager.clearAgentContext(chatId);
  }

  async cleanupOldAgentContext(olderThanDays = 30) {
    return this.agentContextManager.cleanupOldAgentContext(olderThanDays);
  }

  // ═══════════════════ SUMMARIES & LONG-TERM MEMORY ═══════════════════

  async generateAutomaticSummary(chatId) {
    return this.summariesManager.generateAutomaticSummary(chatId);
  }

  async saveConversationSummary(chatId, summary, keyTopics = [], userPreferences = {}, messageCount = 0) {
    return this.summariesManager.saveConversationSummary(chatId, summary, keyTopics, userPreferences, messageCount);
  }

  async getConversationSummaries(chatId, limit = 5) {
    return this.summariesManager.getConversationSummaries(chatId, limit);
  }

  async getUserPreferences(chatId) {
    return this.summariesManager.getUserPreferences(chatId);
  }

  async saveUserPreference(chatId, preferenceKey, preferenceValue) {
    return this.summariesManager.saveUserPreference(chatId, preferenceKey, preferenceValue);
  }

  async cleanupOldSummaries(keepPerChat = 10) {
    return this.summariesManager.cleanupOldSummaries(keepPerChat);
  }

  // ═══════════════════ CLEANUP ═══════════════════

  /**
   * Run full cleanup (message types, commands, agent context + summaries)
   * @returns {Object} - Cleanup stats
   */
  async runFullCleanup() {
    // Cleanup message types (7 days TTL)
    await this.messageTypesManager.cleanup(7 * 24 * 60 * 60 * 1000);
    
    // Cleanup old commands (30 days TTL)
    await this.commandsManager.cleanup(30 * 24 * 60 * 60 * 1000);
    
    // Existing cleanup
    console.log('🧹 Starting full cleanup...');
    
    const contextDeleted = await this.agentContextManager.cleanupOldAgentContext(30);  // 30 days
    const summariesDeleted = await this.summariesManager.cleanupOldSummaries(10);   // Keep 10 per chat
    
    const stats = {
      contextDeleted,
      summariesDeleted,
      totalDeleted: contextDeleted + summariesDeleted,
      timestamp: new Date().toISOString()
    };
    
    console.log(`✅ Full cleanup completed:`, stats);
    return stats;
  }

  /**
   * Start periodic cleanup task (runs monthly)
   */
  startPeriodicCleanup() {
    if (this.cleanupTimeoutHandle || this.cleanupIntervalHandle) {
      console.log('ℹ️ Periodic cleanup already scheduled - skipping duplicate setup');
      return;
    }
    
    // Run cleanup once per month (30 days)
    const MAX_INTERVAL_MS = 2147483647; // ~24.8 days - Node.js timer limit
    const { TIME } = require('../utils/constants');
    const THIRTY_DAYS_MS = TIME.CLEANUP_INTERVAL;
    const CLEANUP_INTERVAL_MS = Math.min(THIRTY_DAYS_MS, MAX_INTERVAL_MS);
    
    // Run first cleanup after 1 hour (to not impact startup)
    this.cleanupTimeoutHandle = setTimeout(async () => {
      this.cleanupTimeoutHandle = null;
      console.log('🧹 Running first scheduled cleanup...');
      await this.runFullCleanup();
      
      // Then schedule monthly cleanups
      this.cleanupIntervalHandle = setInterval(async () => {
        console.log('🧹 Running scheduled cleanup...');
        try {
          await this.runFullCleanup();
        } catch (err) {
          console.error('❌ Error during scheduled cleanup:', err.message);
        }
      }, CLEANUP_INTERVAL_MS);
      
    }, 60 * 60 * 1000);  // 1 hour delay
    
    const intervalDays = Math.round(CLEANUP_INTERVAL_MS / TIME.DAY);
    console.log(`✅ Periodic cleanup scheduled (~every ${intervalDays} days)`);
  }

  /**
   * Close database connection pool
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      console.log('🔌 PostgreSQL connection pool closed');
    }
    if (this.cleanupTimeoutHandle) {
      clearTimeout(this.cleanupTimeoutHandle);
      this.cleanupTimeoutHandle = null;
    }
    if (this.cleanupIntervalHandle) {
      clearInterval(this.cleanupIntervalHandle);
      this.cleanupIntervalHandle = null;
    }
  }
}

// Create and export singleton instance
const conversationManager = new ConversationManager();
module.exports = conversationManager;
