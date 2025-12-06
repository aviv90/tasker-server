// Green API Webhook Data Structures
export interface SenderData {
  chatId: string;
  sender: string;
  senderName: string;
  senderContactName: string;
  chatName: string;
  [key: string]: unknown;
}

export interface MessageData {
  typeMessage: string;
  textMessage?: string;
  caption?: string;
  downloadUrl?: string;
  fileMessageData?: { downloadUrl?: string; caption?: string; fileName?: string; mimeType?: string;[key: string]: unknown };
  audioMessageData?: { downloadUrl?: string; duration?: number;[key: string]: unknown };
  imageMessageData?: { downloadUrl?: string; caption?: string;[key: string]: unknown };
  videoMessageData?: { downloadUrl?: string; caption?: string;[key: string]: unknown };
  stickerMessageData?: { downloadUrl?: string; caption?: string;[key: string]: unknown };
  textMessageData?: { textMessage: string;[key: string]: unknown };
  extendedTextMessageData?: { text: string; description?: string; title?: string; previewType?: string; jpegThumbnail?: string;[key: string]: unknown };
  editedMessageData?: { textMessage: string;[key: string]: unknown };
  quotedMessage?: MessageData; // Recursive
  stanzaId?: string;
  [key: string]: unknown;
}

export interface WebhookData {
  typeWebhook: string;
  idMessage: string;
  senderData: SenderData;
  messageData: MessageData;
  timestamp?: number;
  instanceData?: {
    idInstance: number;
    wid: string;
    typeInstance: string;
  };
  [key: string]: unknown;
}

// Normalized Input for Agent
export interface NormalizedInput {
  userText?: string;
  hasImage?: boolean;
  hasVideo?: boolean;
  hasAudio?: boolean;
  imageUrl?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  quotedContext?: QuotedContext | null;
  originalMessageId?: string;
  chatType?: 'group' | 'private' | 'unknown';
  language?: string;
  authorizations?: {
    media_creation: boolean;
    group_creation: boolean | null;
    voice_allowed: boolean | null;
  };
  senderData?: {
    senderContactName: string;
    chatName: string;
    senderName: string;
    chatId: string;
    senderId: string;
  };
  lastCommand?: LastCommand | null;
  [key: string]: unknown;
}

export interface QuotedContext {
  type: string;
  text?: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  [key: string]: unknown;
}

// Agent Related Types
export { ToolCall, AgentPlan, AgentResult } from '../agent/types';

export interface LastCommand {
  tool: string | null;
  toolArgs?: unknown;
  args?: unknown;
  normalized?: unknown;
  prompt?: string | null;
  failed?: boolean;
  imageUrl?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  isMultiStep?: boolean;
  plan?: unknown;
  [key: string]: unknown;
}

// Manager Interfaces for ConversationManager facade
export interface MessageTypesManager {
  markAsBotMessage: (chatId: string, messageId: string) => Promise<void>;
  markAsUserOutgoing: (chatId: string, messageId: string) => Promise<void>;
  isBotMessage: (chatId: string, messageId: string) => Promise<boolean>;
  cleanup: (ttl: number) => Promise<number>;
  clearAll: () => Promise<void>;
}

export interface CommandsManager {
  saveCommand: (chatId: string, messageId: string, metadata: unknown) => Promise<void>;
  getLastCommand: (chatId: string) => Promise<unknown>;
  cleanup: (ttl: number) => Promise<number>;
  clearAll: () => Promise<void>;
}

export interface AgentContextManager {
  saveAgentContext: (chatId: string, context: unknown) => Promise<void>;
  getAgentContext: (chatId: string) => Promise<unknown>;
  clearAgentContext: (chatId: string) => Promise<void>;
  cleanupOldAgentContext: (olderThanDays: number) => Promise<number>;
}

export interface SummariesManager {
  generateAutomaticSummary: (chatId: string) => Promise<unknown>;
  saveConversationSummary: (chatId: string, summary: string, keyTopics?: string[], userPreferences?: Record<string, unknown>, messageCount?: number) => Promise<void>;
  getConversationSummaries: (chatId: string, limit?: number) => Promise<unknown[]>;
  getUserPreferences: (chatId: string) => Promise<Record<string, unknown>>;
  saveUserPreference: (chatId: string, preferenceKey: string, preferenceValue: unknown) => Promise<void>;
  cleanupOldSummaries: (keepPerChat?: number) => Promise<number>;
}

export interface AllowListsManager {
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

export interface ContactsManager {
  syncContacts: (contactsArray: unknown[]) => Promise<void>;
  getAllContacts: () => Promise<unknown[]>;
  getContactsByType: (type: string) => Promise<unknown[]>;
}

export interface MessagesManager {
  getConversationHistory: (chatId: string) => Promise<unknown[]>;
  addMessage: (chatId: string, role: string, content: string, metadata?: Record<string, unknown>) => Promise<number>;
  trimMessagesForChat: (chatId: string) => Promise<void>;
}
