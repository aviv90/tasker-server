import container from './container';
import DatabaseManager from './conversation/database';
import TasksManager from './conversation/tasks';
import logger from '../utils/logger';
import { Pool } from 'pg';
import { TIME } from '../utils/constants';

// Import interfaces/classes
import CommandsManager, { CommandMetadata, SaveLastCommandOptions } from './conversation/commands';
import MessageTypesManager from './conversation/messageTypes';
import AgentContextManager from './conversation/agentContext';
import SummariesManager from './conversation/summaries';
import AllowListsManager, { SenderData } from './conversation/allowLists';
import ContactsManager, { GreenApiContact } from './conversation/contacts';
import MessagesManager from './conversation/messages';

interface AgentContext {
  toolCalls?: unknown[];
  generatedAssets?: {
    images?: unknown[];
    videos?: unknown[];
    audio?: unknown[];
  };
}

class ConversationManager {
  public isInitialized: boolean = false;
  public pool: Pool | null = null;
  public databaseManager: DatabaseManager;
  public tasksManager: TasksManager;
  private cleanupIntervalHandle: NodeJS.Timeout | null = null;

  constructor() {
    // We keep these here for backward compatibility API
    // But they will delegate to the container's managers where possible
    // @ts-expect-error - DatabaseManager expects ConversationManager interface, but we pass 'this'
    this.databaseManager = new DatabaseManager(this);
    // @ts-expect-error - TasksManager expects ConversationManager interface, but we pass 'this'
    this.tasksManager = new TasksManager(this);

    // Note: We do NOT start initialization here anymore to avoid side effects on import.
    // Call initialize() explicitly.
  }

  // ═══════════════════ INITIALIZATION ═══════════════════

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      logger.info('💭 ConversationManager initializing with DI Container...');
      await container.initialize();
      this.pool = container.pool; // Expose pool for legacy components
      this.isInitialized = true;

      this.startPeriodicCleanup();

    } catch (error: unknown) {
      logger.error('❌ Failed to initialize ConversationManager:', error);
      throw error;
    }
  }

  /**
   * @deprecated Use initialize() instead. Kept for backward compatibility if any.
   */
  async initializeDatabase(): Promise<void> {
    return this.initialize();
  }

  // ═══════════════════ GETTERS (DI) ═══════════════════

  get messageTypesManager(): MessageTypesManager {
    return container.getService('messageTypes');
  }

  get commandsManager(): CommandsManager {
    return container.getService('commands');
  }

  get agentContextManager(): AgentContextManager {
    return container.getService('agentContext');
  }

  get summariesManager(): SummariesManager {
    return container.getService('summaries');
  }

  get allowListsManager(): AllowListsManager {
    return container.getService('allowLists');
  }

  get contactsManager(): ContactsManager {
    return container.getService('contacts');
  }

  // Legacy support for messagesManager (it's deprecated)
  // We explicitly redirect to chatHistoryService as per previous implementation
  get messagesManager(): MessagesManager {
    // Return the real MessagesManager from container (no deprecation warning)
    return container.getService('messages');
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

  async isAuthorizedForVoiceTranscription(senderData: SenderData): Promise<boolean> {
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
    // Clear conversations from DB (MessagesManager handles both DB and cache)
    // Use container's messages service directly (no deprecation warning)
    await container.getService('messages').clearAllConversations();
  }

  async clearConversationsForChat(chatId: string): Promise<number> {
    // Use container's messages service directly (no deprecation warning)
    return container.getService('messages').clearConversationsForChat(chatId);
  }

  // Contacts
  async syncContacts(contactsArray: GreenApiContact[]): Promise<{ inserted: number; updated: number; total: number }> {
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
  async saveCommand(chatId: string, messageId: string, metadata: CommandMetadata): Promise<void> {
    return this.commandsManager.saveCommand(chatId, messageId, metadata);
  }

  async getLastCommand(chatId: string): Promise<unknown> {
    return this.commandsManager.getLastCommand(chatId);
  }

  async saveLastCommand(chatId: string, tool: string | null, args: unknown, options: SaveLastCommandOptions = {}): Promise<void> {
    return this.commandsManager.saveLastCommand(chatId, tool || '', args, options);
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
    return this.agentContextManager.saveAgentContext(chatId, context as AgentContext);
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
    // Use container's messages service directly (no deprecation warning)
    return container.getService('messages').addMessage(chatId, role, content, metadata);
  }

  async trimMessagesForChat(chatId: string): Promise<void> {
    // Use container's messages service directly (no deprecation warning)
    return container.getService('messages').trimMessagesForChat(chatId);
  }

  async getConversationHistory(chatId: string, limit: number | null = null): Promise<unknown[]> {
    // Use container's messages service directly (no deprecation warning)
    return container.getService('messages').getConversationHistory(chatId, limit);
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
      // Pool is managed by container, we just explicitly close it here if needed
      // But container.pool is shared.
      // conversationManager.close() calls this.
    }
    if (this.cleanupIntervalHandle) {
      clearInterval(this.cleanupIntervalHandle);
      this.cleanupIntervalHandle = null;
    }
    // We should really call container shutdown/close if it existed, but it relies on pool end.
    // We can assume pool ending happens at container level if we added a close method there.
    // But here we just clear interval.
  }
}

const conversationManager = new ConversationManager();
export default conversationManager;
