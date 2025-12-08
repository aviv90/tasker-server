import container from './container';

import TasksManager from './conversation/tasks';
import { Pool } from 'pg';
import logger from '../utils/logger';

// Import interfaces/classes
import CommandsManager, { CommandMetadata } from './conversation/commands';
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
  // ═══════════════════ PROXY STATE ═══════════════════

  get isInitialized(): boolean {
    return container.isInitialized;
  }

  get pool(): Pool | null {
    return container.pool;
  }

  // ═══════════════════ INITIALIZATION ═══════════════════

  async initialize(): Promise<void> {
    logger.info('💭 ConversationManager initializing (via Container)...');
    return container.initialize();
  }

  /**
   * @deprecated Use initialize() instead. Kept for backward compatibility.
   */
  async initializeDatabase(): Promise<void> {
    return this.initialize();
  }

  // ═══════════════════ GETTERS (DI) ═══════════════════

  get tasksManager(): TasksManager {
    return container.getService('tasks');
  }

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
  get messagesManager(): MessagesManager {
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
    await container.getService('messages').clearAllConversations();
  }

  async clearConversationsForChat(chatId: string): Promise<number> {
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
    return container.runFullCleanup();
  }

  async close(): Promise<void> {
    return container.close();
  }
}

const conversationManager = new ConversationManager();
export default conversationManager;
