const DatabaseManager = require('./conversation/database');
const TasksManager = require('./conversation/tasks');
const logger = require('../utils/logger');
const container = require('./container');

class ConversationManager {
  constructor() {
    this.isInitialized = false;
    this.pool = null;
    
    // We keep these here for backward compatibility API
    // But they will delegate to the container's managers
    this.databaseManager = new DatabaseManager(this);
    this.tasksManager = new TasksManager(this); 
    // Note: TasksManager is simple and still expects 'this' context in old code
    // Ideally we should refactor it too, but for now we focus on the main ones.
    
    logger.info('💭 ConversationManager initializing with DI Container...');
    this.initializeDatabase();
  }

  // ═══════════════════ INITIALIZATION ═══════════════════
  
  async initializeDatabase(attempt = 1) {
    try {
      await container.initialize();
      this.pool = container.pool; // Expose pool for legacy components
      this.isInitialized = true;
      
      // Legacy DB manager just logs now, container handles migrations
      
      this.startPeriodicCleanup();
      
    } catch (error) {
      logger.error('❌ Failed to initialize ConversationManager:', error);
    }
  }

  // ═══════════════════ GETTERS (DI) ═══════════════════

  get messageTypesManager() { return container.getService('messageTypes'); }
  get commandsManager() { return container.getService('commands'); }
  get agentContextManager() { return container.getService('agentContext'); }
  get summariesManager() { return container.getService('summaries'); }
  get allowListsManager() { return container.getService('allowLists'); }
  get contactsManager() { return container.getService('contacts'); }
  
  // Legacy support for messagesManager (it's deprecated anyway)
  get messagesManager() { 
    return {
      getConversationHistory: async (chatId) => {
        logger.warn('⚠️ [DEPRECATED] conversationManager.messagesManager used. Use chatHistoryService.');
        const { getChatHistory } = require('../utils/chatHistoryService');
        const result = await getChatHistory(chatId);
        return result.messages || [];
      },
      addMessage: async () => logger.warn('⚠️ addMessage is deprecated'),
      trimMessagesForChat: async () => {}
    };
  }

  // ═══════════════════ FACADE METHODS ═══════════════════
  // Delegating to specific managers from the container

  // Voice & Allow Lists
  async setVoiceTranscriptionStatus(enabled) { return this.allowListsManager.setVoiceTranscriptionStatus(enabled); }
  async getVoiceTranscriptionStatus() { return this.allowListsManager.getVoiceTranscriptionStatus(); }
  async addToVoiceAllowList(contactName) { return this.allowListsManager.addToVoiceAllowList(contactName); }
  async removeFromVoiceAllowList(contactName) { return this.allowListsManager.removeFromVoiceAllowList(contactName); }
  async getVoiceAllowList() { return this.allowListsManager.getVoiceAllowList(); }
  async isInVoiceAllowList(contactName) { return this.allowListsManager.isInVoiceAllowList(contactName); }
  async isAuthorizedForVoiceTranscription(senderData) { return this.allowListsManager.isAuthorizedForVoiceTranscription(senderData); }
  
  async addToMediaAllowList(contactName) { return this.allowListsManager.addToMediaAllowList(contactName); }
  async removeFromMediaAllowList(contactName) { return this.allowListsManager.removeFromMediaAllowList(contactName); }
  async getMediaAllowList() { return this.allowListsManager.getMediaAllowList(); }
  
  async addToGroupCreationAllowList(contactName) { return this.allowListsManager.addToGroupCreationAllowList(contactName); }
  async removeFromGroupCreationAllowList(contactName) { return this.allowListsManager.removeFromGroupCreationAllowList(contactName); }
  async getGroupCreationAllowList() { return this.allowListsManager.getGroupCreationAllowList(); }
  async isInGroupCreationAllowList(contactName) { return this.allowListsManager.isInGroupCreationAllowList(contactName); }
  
  async getDatabaseStats() { return this.allowListsManager.getDatabaseStats(); }
  async clearAllConversations() { return this.allowListsManager.clearAllConversations(); }

  // Contacts
  async syncContacts(contactsArray) { return this.contactsManager.syncContacts(contactsArray); }
  async getAllContacts() { return this.contactsManager.getAllContacts(); }
  async getContactsByType(type) { return this.contactsManager.getContactsByType(type); }

  // Message Types
  async markAsBotMessage(chatId, messageId) { return this.messageTypesManager.markAsBotMessage(chatId, messageId); }
  async markAsUserOutgoing(chatId, messageId) { return this.messageTypesManager.markAsUserOutgoing(chatId, messageId); }
  async isBotMessage(chatId, messageId) { return this.messageTypesManager.isBotMessage(chatId, messageId); }
  async clearAllMessageTypes() { return this.messageTypesManager.clearAll(); }

  // Commands
  async saveCommand(chatId, messageId, metadata) { return this.commandsManager.saveCommand(chatId, messageId, metadata); }
  async getLastCommand(chatId) { return this.commandsManager.getLastCommand(chatId); }
  async saveLastCommand(chatId, tool, args, options = {}) { return this.commandsManager.saveLastCommand(chatId, tool, args, options); }

  // Tasks (Simple)
  async saveTask(taskId, status, data = {}) { return this.tasksManager.saveTask(taskId, status, data); }
  async getTask(taskId) { return this.tasksManager.getTask(taskId); }

  // Agent Context
  async saveAgentContext(chatId, context) { return this.agentContextManager.saveAgentContext(chatId, context); }
  async getAgentContext(chatId) { return this.agentContextManager.getAgentContext(chatId); }
  async clearAgentContext(chatId) { return this.agentContextManager.clearAgentContext(chatId); }
  async cleanupOldAgentContext(olderThanDays = 30) { return this.agentContextManager.cleanupOldAgentContext(olderThanDays); }

  // Summaries
  async generateAutomaticSummary(chatId) { return this.summariesManager.generateAutomaticSummary(chatId); }
  async saveConversationSummary(chatId, summary, keyTopics = [], userPreferences = {}, messageCount = 0) { return this.summariesManager.saveConversationSummary(chatId, summary, keyTopics, userPreferences, messageCount); }
  async getConversationSummaries(chatId, limit = 5) { return this.summariesManager.getConversationSummaries(chatId, limit); }
  async getUserPreferences(chatId) { return this.summariesManager.getUserPreferences(chatId); }
  async saveUserPreference(chatId, preferenceKey, preferenceValue) { return this.summariesManager.saveUserPreference(chatId, preferenceKey, preferenceValue); }
  async cleanupOldSummaries(keepPerChat = 10) { return this.summariesManager.cleanupOldSummaries(keepPerChat); }

  // Deprecated Wrappers
  async addMessage(chatId, role, content, metadata = {}) { return this.messagesManager.addMessage(chatId, role, content, metadata); }
  async trimMessagesForChat(chatId) { return this.messagesManager.trimMessagesForChat(chatId); }
  async getConversationHistory(chatId) { return this.messagesManager.getConversationHistory(chatId); }

  // Cleanup
  async runFullCleanup() {
    const { TIME } = require('../utils/constants');
    // Cleanup message types (30 days TTL)
    await this.messageTypesManager.cleanup(30 * TIME.DAY);
    
    // Cleanup old commands (30 days TTL)
    await this.commandsManager.cleanup(30 * TIME.DAY);
    
    logger.info('🧹 Starting full cleanup...');
    const contextDeleted = await this.agentContextManager.cleanupOldAgentContext(30);
    const summariesDeleted = await this.summariesManager.cleanupOldSummaries(10);
    
    const stats = { contextDeleted, summariesDeleted, totalDeleted: contextDeleted + summariesDeleted };
    logger.info(`✅ Full cleanup completed:`, stats);
    return stats;
  }

  startPeriodicCleanup() {
    if (this.cleanupIntervalHandle) return;
    
    const { TIME } = require('../utils/constants');
    const CLEANUP_INTERVAL_MS = Math.min(TIME.CLEANUP_INTERVAL, 2147483647);
    
    setTimeout(async () => {
      logger.info('🧹 Running first scheduled cleanup...');
      await this.runFullCleanup();
      
      this.cleanupIntervalHandle = setInterval(async () => {
        logger.info('🧹 Running scheduled cleanup...');
        await this.runFullCleanup();
      }, CLEANUP_INTERVAL_MS);
    }, TIME.CLEANUP_DELAY);
    
    logger.info(`✅ Periodic cleanup scheduled (~every 30 days)`);
  }

  async close() {
    if (this.pool) {
      await this.pool.end(); // Pool is managed by container
      logger.info('🔌 PostgreSQL connection pool closed');
    }
    if (this.cleanupIntervalHandle) clearInterval(this.cleanupIntervalHandle);
  }
}

const conversationManager = new ConversationManager();
module.exports = conversationManager;
