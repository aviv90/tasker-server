import DatabaseManager from './conversation/database';
import TasksManager from './conversation/tasks';
import logger from '../utils/logger';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const container = require('./container');
import { Pool } from 'pg';
import { TIME } from '../utils/constants';

/**
 * Container interface
 */
interface Container {
  initialize: () => Promise<void>;
  pool: Pool | null;
  getService: (name: string) => unknown;
}

/**
 * Service manager interfaces
 */
interface MessageTypesManager {
  markAsBotMessage: (chatId: string, messageId: string) => Promise<void>;
  markAsUserOutgoing: (chatId: string, messageId: string) => Promise<void>;
  isBotMessage: (chatId: string, messageId: string) => Promise<boolean>;
  cleanup: (ttl: number) => Promise<number>;
  clearAll: () => Promise<void>;
}

interface CommandsManager {
  saveCommand: (chatId: string, messageId: string, metadata: unknown) => Promise<void>;
  getLastCommand: (chatId: string) => Promise<unknown>;
  saveLastCommand: (chatId: string, tool: string | null, args: unknown, options?: unknown) => Promise<void>;
  cleanup: (ttl: number) => Promise<number>;
  clearAll: () => Promise<void>;
}

interface AgentContextManager {
  saveAgentContext: (chatId: string, context: unknown) => Promise<void>;
  getAgentContext: (chatId: string) => Promise<unknown>;
  clearAgentContext: (chatId: string) => Promise<void>;
  cleanupOldAgentContext: (olderThanDays: number) => Promise<number>;
}

interface SummariesManager {
  generateAutomaticSummary: (chatId: string) => Promise<unknown>;
  saveConversationSummary: (chatId: string, summary: string, keyTopics?: string[], userPreferences?: Record<string, unknown>, messageCount?: number) => Promise<void>;
  getConversationSummaries: (chatId: string, limit?: number) => Promise<unknown[]>;
  getUserPreferences: (chatId: string) => Promise<Record<string, unknown>>;
  saveUserPreference: (chatId: string, preferenceKey: string, preferenceValue: unknown) => Promise<void>;
  cleanupOldSummaries: (keepPerChat?: number) => Promise<number>;
}

interface AllowListsManager {
  setVoiceTranscriptionStatus: (enabled: boolean) => Promise<void>;
  getVoiceTranscriptionStatus: () => Promise<boolean>;
  addToVoiceAllowList: (contactName: string) => Promise<void>;
  removeFromVoiceAllowList: (contactName: string) => Promise<void>;
  getVoiceAllowList: () => Promise<string[]>;
  isInVoiceAllowList: (contactName: string) => Promise<boolean>;
  isAuthorizedForVoiceTranscription: (senderData: unknown) => Promise<boolean>;
  addToMediaAllowList: (contactName: string) => Promise<void>;
  removeFromMediaAllowList: (contactName: string) => Promise<void>;
  getMediaAllowList: () => Promise<string[]>;
  addToGroupCreationAllowList: (contactName: string) => Promise<void>;
  removeFromGroupCreationAllowList: (contactName: string) => Promise<void>;
  getGroupCreationAllowList: () => Promise<string[]>;
  isInGroupCreationAllowList: (contactName: string) => Promise<boolean>;
  getDatabaseStats: () => Promise<unknown>;
  clearAllConversations: () => Promise<void>;
}

interface ContactsManager {
  syncContacts: (contactsArray: unknown[]) => Promise<void>;
  getAllContacts: () => Promise<unknown[]>;
  getContactsByType: (type: string) => Promise<unknown[]>;
}

interface MessagesManager {
  getConversationHistory: (chatId: string) => Promise<unknown[]>;
  addMessage: (chatId: string, role: string, content: string, metadata?: Record<string, unknown>) => Promise<number>;
  trimMessagesForChat: (chatId: string) => Promise<void>;
}

class ConversationManager {
  public isInitialized: boolean = false;
  public pool: Pool | null = null;
  public databaseManager: DatabaseManager;
  public tasksManager: TasksManager;
  private cleanupIntervalHandle: NodeJS.Timeout | null = null;

  constructor() {
    // We keep these here for backward compatibility API
    // But they will delegate to the container's managers
    // @ts-expect-error - DatabaseManager expects ConversationManager interface, but we pass 'this'
    this.databaseManager = new DatabaseManager(this);
    // @ts-expect-error - TasksManager expects ConversationManager interface, but we pass 'this'
    this.tasksManager = new TasksManager(this); 
    // Note: TasksManager is simple and still expects 'this' context in old code
    // Ideally we should refactor it too, but for now we focus on the main ones.
    
    logger.info('💭 ConversationManager initializing with DI Container...');
    void this.initializeDatabase();
  }

  // ═══════════════════ INITIALIZATION ═══════════════════
  
  async initializeDatabase(attempt: number = 1): Promise<void> {
    try {
      const containerInstance = container as Container;
      await containerInstance.initialize();
      this.pool = containerInstance.pool; // Expose pool for legacy components
      this.isInitialized = true;
      
      // Legacy DB manager just logs now, container handles migrations
      void attempt; // Suppress unused parameter warning
      
      this.startPeriodicCleanup();
      
    } catch (error: unknown) {
      logger.error('❌ Failed to initialize ConversationManager:', error);
    }
  }

  // ═══════════════════ GETTERS (DI) ═══════════════════

  get messageTypesManager(): MessageTypesManager {
    return container.getService('messageTypes') as MessageTypesManager;
  }

  get commandsManager(): CommandsManager {
    return container.getService('commands') as CommandsManager;
  }

  get agentContextManager(): AgentContextManager {
    return container.getService('agentContext') as AgentContextManager;
  }

  get summariesManager(): SummariesManager {
    return container.getService('summaries') as SummariesManager;
  }

  get allowListsManager(): AllowListsManager {
    return container.getService('allowLists') as AllowListsManager;
  }

  get contactsManager(): ContactsManager {
    return container.getService('contacts') as ContactsManager;
  }
  
  // Legacy support for messagesManager (it's deprecated anyway)
  get messagesManager(): MessagesManager {
    return {
      getConversationHistory: async (chatId: string) => {
        logger.warn('⚠️ [DEPRECATED] conversationManager.messagesManager used. Use chatHistoryService.');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getChatHistory } = require('../utils/chatHistoryService');
        const result = await getChatHistory(chatId);
        return (result.messages || []) as unknown[];
      },
      addMessage: async () => {
        logger.warn('⚠️ addMessage is deprecated');
        return 0;
      },
      trimMessagesForChat: async () => {
        // No-op
      }
    };
  }

  // ═══════════════════ FACADE METHODS ═══════════════════
  // Delegating to specific managers from the container

  // Voice & Allow Lists
  async setVoiceTranscriptionStatus(enabled: boolean): Promise<void> {
    return this.allowListsManager.setVoiceTranscriptionStatus(enabled);
  }

  async getVoiceTranscriptionStatus(): Promise<boolean> {
    return this.allowListsManager.getVoiceTranscriptionStatus();
  }

  async addToVoiceAllowList(contactName: string): Promise<boolean> {
    await this.allowListsManager.addToVoiceAllowList(contactName);
    return true; // Return true to indicate success (for backward compatibility)
  }

  async removeFromVoiceAllowList(contactName: string): Promise<boolean> {
    await this.allowListsManager.removeFromVoiceAllowList(contactName);
    return true; // Return true to indicate success (for backward compatibility)
  }

  async getVoiceAllowList(): Promise<string[]> {
    return this.allowListsManager.getVoiceAllowList();
  }

  async isInVoiceAllowList(contactName: string): Promise<boolean> {
    return this.allowListsManager.isInVoiceAllowList(contactName);
  }

  async isAuthorizedForVoiceTranscription(senderData: unknown): Promise<boolean> {
    return this.allowListsManager.isAuthorizedForVoiceTranscription(senderData);
  }
  
  async addToMediaAllowList(contactName: string): Promise<boolean> {
    await this.allowListsManager.addToMediaAllowList(contactName);
    return true; // Return true to indicate success (for backward compatibility)
  }

  async removeFromMediaAllowList(contactName: string): Promise<boolean> {
    await this.allowListsManager.removeFromMediaAllowList(contactName);
    return true; // Return true to indicate success (for backward compatibility)
  }

  async getMediaAllowList(): Promise<string[]> {
    return this.allowListsManager.getMediaAllowList();
  }
  
  async addToGroupCreationAllowList(contactName: string): Promise<boolean> {
    await this.allowListsManager.addToGroupCreationAllowList(contactName);
    return true; // Return true to indicate success (for backward compatibility)
  }

  async removeFromGroupCreationAllowList(contactName: string): Promise<boolean> {
    await this.allowListsManager.removeFromGroupCreationAllowList(contactName);
    return true; // Return true to indicate success (for backward compatibility)
  }

  async getGroupCreationAllowList(): Promise<string[]> {
    return this.allowListsManager.getGroupCreationAllowList();
  }

  async isInGroupCreationAllowList(contactName: string): Promise<boolean> {
    return this.allowListsManager.isInGroupCreationAllowList(contactName);
  }
  
  async getDatabaseStats(): Promise<unknown> {
    return this.allowListsManager.getDatabaseStats();
  }

  async clearAllConversations(): Promise<void> {
    return this.allowListsManager.clearAllConversations();
  }

  // Contacts
  async syncContacts(contactsArray: unknown[]): Promise<{ inserted: number; updated: number; total: number }> {
    await this.contactsManager.syncContacts(contactsArray);
    // Return default stats for backward compatibility
    return { inserted: 0, updated: 0, total: contactsArray.length };
  }

  async getAllContacts(): Promise<unknown[]> {
    return this.contactsManager.getAllContacts();
  }

  async getContactsByType(type: string): Promise<unknown[]> {
    return this.contactsManager.getContactsByType(type);
  }

  // Message Types
  async markAsBotMessage(chatId: string, messageId: string): Promise<void> {
    return this.messageTypesManager.markAsBotMessage(chatId, messageId);
  }

  async markAsUserOutgoing(chatId: string, messageId: string): Promise<void> {
    return this.messageTypesManager.markAsUserOutgoing(chatId, messageId);
  }

  async isBotMessage(chatId: string, messageId: string): Promise<boolean> {
    return this.messageTypesManager.isBotMessage(chatId, messageId);
  }

  async clearAllMessageTypes(): Promise<void> {
    return this.messageTypesManager.clearAll();
  }

  // Commands
  async saveCommand(chatId: string, messageId: string, metadata: unknown): Promise<void> {
    return this.commandsManager.saveCommand(chatId, messageId, metadata);
  }

  async getLastCommand(chatId: string): Promise<unknown> {
    return this.commandsManager.getLastCommand(chatId);
  }

  async saveLastCommand(chatId: string, tool: string | null, args: unknown, options: unknown = {}): Promise<void> {
    return this.commandsManager.saveLastCommand(chatId, tool, args, options);
  }

  get commandsManagerClearAll(): () => Promise<void> {
    return () => this.commandsManager.clearAll();
  }

  // Tasks (Simple)
  async saveTask(taskId: string, status: string, data: Record<string, unknown> = {}): Promise<void> {
    return this.tasksManager.saveTask(taskId, status, data);
  }

  async getTask(taskId: string): Promise<unknown> {
    return this.tasksManager.getTask(taskId);
  }

  // Agent Context
  async saveAgentContext(chatId: string, context: unknown): Promise<void> {
    return this.agentContextManager.saveAgentContext(chatId, context);
  }

  async getAgentContext(chatId: string): Promise<unknown> {
    return this.agentContextManager.getAgentContext(chatId);
  }

  async clearAgentContext(chatId: string): Promise<void> {
    return this.agentContextManager.clearAgentContext(chatId);
  }

  async cleanupOldAgentContext(olderThanDays: number = 30): Promise<number> {
    return this.agentContextManager.cleanupOldAgentContext(olderThanDays);
  }

  // Summaries
  async generateAutomaticSummary(chatId: string): Promise<unknown> {
    return this.summariesManager.generateAutomaticSummary(chatId);
  }

  async saveConversationSummary(chatId: string, summary: string, keyTopics: string[] = [], userPreferences: Record<string, unknown> = {}, messageCount: number = 0): Promise<void> {
    return this.summariesManager.saveConversationSummary(chatId, summary, keyTopics, userPreferences, messageCount);
  }

  async getConversationSummaries(chatId: string, limit: number = 5): Promise<unknown[]> {
    return this.summariesManager.getConversationSummaries(chatId, limit);
  }

  async getUserPreferences(chatId: string): Promise<Record<string, unknown>> {
    return this.summariesManager.getUserPreferences(chatId);
  }

  async saveUserPreference(chatId: string, preferenceKey: string, preferenceValue: unknown): Promise<void> {
    return this.summariesManager.saveUserPreference(chatId, preferenceKey, preferenceValue);
  }

  async cleanupOldSummaries(keepPerChat: number = 10): Promise<number> {
    return this.summariesManager.cleanupOldSummaries(keepPerChat);
  }

  // Deprecated Wrappers
  async addMessage(chatId: string, role: string, content: string, metadata: Record<string, unknown> = {}): Promise<number> {
    return this.messagesManager.addMessage(chatId, role, content, metadata);
  }

  async trimMessagesForChat(chatId: string): Promise<void> {
    return this.messagesManager.trimMessagesForChat(chatId);
  }

  async getConversationHistory(chatId: string): Promise<unknown[]> {
    return this.messagesManager.getConversationHistory(chatId);
  }

  // Cleanup
  async runFullCleanup(): Promise<{ contextDeleted: number; summariesDeleted: number; totalDeleted: number }> {
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

  startPeriodicCleanup(): void {
    if (this.cleanupIntervalHandle) return;
    
    const CLEANUP_INTERVAL_MS = Math.min(TIME.CLEANUP_INTERVAL, 2147483647);
    
    setTimeout(async () => {
      logger.info('🧹 Running first scheduled cleanup...');
      await this.runFullCleanup();
      
      this.cleanupIntervalHandle = setInterval(async () => {
        logger.info('🧹 Running scheduled cleanup...');
        await this.runFullCleanup();
      }, CLEANUP_INTERVAL_MS);
    }, 1000); // 1 second delay before first cleanup
    
    logger.info(`✅ Periodic cleanup scheduled (~every 30 days)`);
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end(); // Pool is managed by container
      logger.info('🔌 PostgreSQL connection pool closed');
    }
    if (this.cleanupIntervalHandle) {
      clearInterval(this.cleanupIntervalHandle);
      this.cleanupIntervalHandle = null;
    }
  }
}

const conversationManager = new ConversationManager();
export default conversationManager;

