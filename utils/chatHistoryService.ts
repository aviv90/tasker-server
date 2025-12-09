/**
 * Chat History Service
 * 
 * SSOT (Single Source of Truth) for retrieving chat history.
 * Centralizes all history retrieval logic to ensure consistency.
 * 
 * Refactored to separate formatting logic (v1398).
 */

import { getServices } from '../services/agent/utils/serviceLoader';
import logger from './logger';
import {
  GreenApiMessage,
  InternalMessage,
  formatDisplayMessage,
  formatInternal
} from './chat/messageFormatter';

export { ChatHistoryOptions, ChatHistoryResult };

/**
 * Chat history options
 */
interface ChatHistoryOptions {
  includeSystemMessages?: boolean;
  format?: 'internal' | 'display';
  useDbCache?: boolean; // Use DB cache for fast retrieval (for agent history, limit <= 10)
}

/**
 * Chat history result
 */
interface ChatHistoryResult {
  success: boolean;
  data?: string;
  error?: string;
  messages: InternalMessage[];
  formatted: string;
}

/**
 * Get chat history from Green API (SSOT - Single Source of Truth)
 * @param chatId - Chat ID
 * @param limit - Number of messages to retrieve
 * @param options - Additional options
 * @returns Formatted history with messages array
 */
export async function getChatHistory(
  chatId: string,
  limit: number = 20,
  options: ChatHistoryOptions = {}
): Promise<ChatHistoryResult> {
  const { includeSystemMessages = false, format = 'internal', useDbCache = false } = options;

  try {
    // For agent history (10 messages), use DB cache for performance
    // Only use DB cache if limit is reasonable (<= 10) to avoid performance issues
    if (useDbCache && limit > 0 && limit <= 10) {
      // Use container's messages service directly (no deprecation warning)
      const containerModule = await import('../services/container');
      const container = containerModule.default;
      if (container.isInitialized) {
        try {
          // Pass limit directly to DB query for optimal performance (no slice needed)
          const messagesManager = container.getService('messages');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const dbHistory = await messagesManager.getConversationHistory(chatId, limit) as any[];

          if (dbHistory && dbHistory.length > 0) {
            logger.debug(`📜 [ChatHistory] Using DB cache: ${dbHistory.length} messages for chat: ${chatId}`);

            // Convert DB format to InternalMessage format
            const messages: InternalMessage[] = dbHistory.map(msg => ({
              role: msg.role === 'assistant' ? 'assistant' : 'user',
              content: msg.content,
              metadata: (msg.metadata || {}) as InternalMessage['metadata'],
              timestamp: msg.timestamp
            }));

            if (format === 'display') {
              // Re-map internal messages to GreenApiMessage like structure for display formatter? 
              // Actually formatDisplayMessage expects GreenApiMessage.
              // It might be better to have formatDisplayMessageFromInternal.
              // For now, let's keep the simple logic here for DB cache or verify if we need full formatter.
              // The DB cache path is optimization. Let's simple format it here or reuse logic.

              const formattedHistory = messages.map((msg, idx) => {
                const role = msg.role === 'assistant' ? 'בוט' : 'משתמש';
                let content = `${role}: ${msg.content}`;

                if (msg.metadata.imageUrl) content += ` [תמונה: image_id=${idx}, url=${msg.metadata.imageUrl}]`;
                if (msg.metadata.videoUrl) content += ` [וידאו: video_id=${idx}, url=${msg.metadata.videoUrl}]`;
                if (msg.metadata.audioUrl) content += ` [אודיו: audio_id=${idx}, url=${msg.metadata.audioUrl}]`;

                return content;
              }).join('\n');

              return {
                success: true,
                data: `היסטוריה של ${messages.length} הודעות אחרונות:\n\n${formattedHistory}`,
                messages,
                formatted: formattedHistory
              };
            } else {
              return {
                success: true,
                data: `היסטוריה של ${messages.length} הודעות אחרונות`,
                messages,
                formatted: ''
              };
            }
          }
        } catch (dbError) {
          logger.warn('⚠️ [ChatHistory] DB cache failed, falling back to Green API', { error: dbError });
        }
      }
    }

    // Fallback to Green API (for tool usage or if DB cache unavailable)
    const { greenApiService } = getServices();
    logger.debug(`📜 [ChatHistory] Fetching last ${limit} messages from Green API for chat: ${chatId}`);

    const greenApiHistory = await greenApiService.getChatHistory(chatId, limit) as GreenApiMessage[];

    if (!greenApiHistory || greenApiHistory.length === 0) {
      return {
        success: true,
        data: 'אין היסטוריית הודעות זמינה',
        messages: [],
        formatted: ''
      };
    }

    // Filter system messages if needed
    const filteredHistory = includeSystemMessages
      ? greenApiHistory
      : greenApiHistory.filter(msg => {
        const isSystemMessage =
          msg.typeMessage === 'notificationMessage' ||
          msg.type === 'notification' ||
          (msg.textMessage && msg.textMessage.startsWith('System:'));
        return !isSystemMessage;
      });

    // CRITICAL: Green API returns newest-first. Reverse to chronological.
    const chronologicalHistory = [...filteredHistory].reverse();

    if (format === 'display') {
      const formattedHistoryPromises = chronologicalHistory.map((msg, idx) => formatDisplayMessage(msg, idx, chatId));
      const formattedHistory = (await Promise.all(formattedHistoryPromises)).join('\n');
      const internalFormat = await formatInternal(chronologicalHistory, chatId);

      return {
        success: true,
        data: `היסטוריה של ${chronologicalHistory.length} הודעות אחרונות:\n\n${formattedHistory}`,
        messages: internalFormat,
        formatted: formattedHistory
      };
    } else {
      return {
        success: true,
        data: `היסטוריה של ${chronologicalHistory.length} הודעות אחרונות`,
        messages: await formatInternal(chronologicalHistory, chatId),
        formatted: ''
      };
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    logger.error('❌ [ChatHistory] Error fetching chat history from Green API:', {
      error: errorMessage,
      chatId,
      stack: errorStack
    });

    return {
      success: false,
      error: `שגיאה בשליפת היסטוריית השיחה: ${errorMessage}`,
      messages: [],
      formatted: ''
    };
  }
}

/**
 * Get raw chat history from Green API
 */
export async function getRawChatHistory(
  chatId: string,
  limit: number = 20,
  includeSystemMessages: boolean = false
): Promise<GreenApiMessage[]> {
  try {
    const { greenApiService } = getServices();
    const greenApiHistory = await greenApiService.getChatHistory(chatId, limit) as GreenApiMessage[];

    if (!greenApiHistory || greenApiHistory.length === 0) {
      return [];
    }

    // Filter system messages
    let filteredHistory = greenApiHistory;
    if (!includeSystemMessages) {
      filteredHistory = greenApiHistory.filter(msg => {
        const isSystemMessage =
          msg.typeMessage === 'notificationMessage' ||
          msg.type === 'notification' ||
          (msg.textMessage && msg.textMessage.startsWith('System:'));
        return !isSystemMessage;
      });
    }

    // Reverse to chronological
    return [...filteredHistory].reverse();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ [ChatHistory] Error fetching raw chat history:', { error: errorMessage, chatId });
    throw error;
  }
}
