/**
 * Chat History Service
 * 
 * SSOT (Single Source of Truth) for retrieving chat history.
 * Centralizes all history retrieval logic to ensure consistency.
 * 
 * Architecture:
 * - Primary: Green API getChatHistory (complete message history)
 * - Fallback: None (DB doesn't contain full history, only old commands)
 * - Message Type Identification: conversationManager (DB-backed)
 */

import { getServices } from '../services/agent/utils/serviceLoader';
import conversationManager from '../services/conversationManager';
import logger from './logger';

/**
 * Green API message structure
 */
interface GreenApiMessage {
  idMessage?: string;
  typeMessage?: string;
  textMessage?: string;
  caption?: string;
  extendedTextMessage?: {
    text?: string;
  };
  imageMessageData?: {
    downloadUrl?: string;
  };
  videoMessageData?: {
    downloadUrl?: string;
  };
  audioMessageData?: {
    downloadUrl?: string;
  };
  downloadUrl?: string;
  urlFile?: string;
  senderName?: string;
  timestamp?: number;
  type?: string;
}

/**
 * Internal message format
 */
interface InternalMessage {
  role: 'assistant' | 'user';
  content: string;
  metadata: {
    hasImage?: boolean;
    hasVideo?: boolean;
    hasAudio?: boolean;
    imageUrl?: string;
    videoUrl?: string;
    audioUrl?: string;
  };
  timestamp: number;
}

/**
 * Chat history options
 */
export interface ChatHistoryOptions {
  includeSystemMessages?: boolean;
  format?: 'internal' | 'display';
  useDbCache?: boolean; // Use DB cache for fast retrieval (for agent history, limit <= 10)
}

/**
 * Chat history result
 */
export interface ChatHistoryResult {
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
    // For tool history (50 messages), use Green API for completeness
    if (useDbCache && limit <= 10) {
      const conversationManager = (await import('../services/conversationManager')).default;
      if (conversationManager.isInitialized) {
        try {
          const dbHistory = await conversationManager.getConversationHistory(chatId) as Array<{
            role: string;
            content: string;
            metadata?: Record<string, unknown>;
            timestamp: number;
          }>;
          // Take only the last N messages (limit)
          const limitedHistory = dbHistory.slice(-limit);
          if (limitedHistory && limitedHistory.length > 0) {
            logger.debug(`📜 [ChatHistory] Using DB cache: ${limitedHistory.length} messages for chat: ${chatId}`);
            
            // Convert DB format to InternalMessage format
            const messages: InternalMessage[] = limitedHistory.map((msg: {
              role: string;
              content: string;
              metadata?: Record<string, unknown>;
              timestamp: number;
            }) => ({
              role: msg.role === 'assistant' ? 'assistant' : 'user',
              content: msg.content,
              metadata: (msg.metadata || {}) as {
                hasImage?: boolean;
                hasVideo?: boolean;
                hasAudio?: boolean;
                imageUrl?: string;
                videoUrl?: string;
                audioUrl?: string;
              },
              timestamp: msg.timestamp
            }));
            
            if (format === 'display') {
              const formattedHistory = messages.map((msg, idx) => {
                const role = msg.role === 'assistant' ? 'בוט' : 'משתמש';
                let content = `${role}: ${msg.content}`;
                
                if (msg.metadata.imageUrl) {
                  content += ` [תמונה: image_id=${idx}, url=${msg.metadata.imageUrl}]`;
                }
                if (msg.metadata.videoUrl) {
                  content += ` [וידאו: video_id=${idx}, url=${msg.metadata.videoUrl}]`;
                }
                if (msg.metadata.audioUrl) {
                  content += ` [אודיו: audio_id=${idx}, url=${msg.metadata.audioUrl}]`;
                }
                
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
    
    // Format based on requested format
    if (format === 'display') {
      const formattedHistoryPromises = filteredHistory.map(async (msg, idx) => {
          const isFromBot = msg.idMessage ? await conversationManager.isBotMessage(chatId, msg.idMessage) : false;
          const role = isFromBot ? 'בוט' : 'משתמש';
          const senderName = msg.senderName || (isFromBot ? 'בוט' : 'משתמש');
          
          const textContent = msg.textMessage || 
                            msg.caption || 
                            (msg.extendedTextMessage && msg.extendedTextMessage.text) ||
                            (msg.typeMessage === 'extendedTextMessage' && msg.extendedTextMessage?.text);
          
          let content = '';
          if (textContent && textContent.trim()) {
            content = `${role} (${senderName}): ${textContent}`;
          } else {
            content = `${role} (${senderName}): [הודעה ללא טקסט]`;
          }
          
          // Add media indicators
          if (msg.typeMessage === 'imageMessage' || msg.typeMessage === 'image') {
            const imageUrl = msg.downloadUrl || msg.urlFile || msg.imageMessageData?.downloadUrl;
            if (imageUrl) {
              content += ` [תמונה: image_id=${idx}, url=${imageUrl}]`;
            } else {
              content += ' [תמונה מצורפת]';
            }
          }
          
          if (msg.typeMessage === 'videoMessage' || msg.typeMessage === 'video') {
            const videoUrl = msg.downloadUrl || msg.urlFile || msg.videoMessageData?.downloadUrl;
            if (videoUrl) {
              content += ` [וידאו: video_id=${idx}, url=${videoUrl}]`;
            } else {
              content += ' [וידאו מצורף]';
            }
          }
          
          if (msg.typeMessage === 'audioMessage' || msg.typeMessage === 'audio') {
            const audioUrl = msg.downloadUrl || msg.urlFile || msg.audioMessageData?.downloadUrl;
            if (audioUrl) {
              content += ` [אודיו: audio_id=${idx}, url=${audioUrl}]`;
            } else {
              content += ' [הקלטה קולית]';
            }
          }
          
          // Add timestamp if available
          if (msg.timestamp) {
            const date = new Date(msg.timestamp * 1000);
            content += ` [${date.toLocaleString('he-IL')}]`;
          }
          
          return content;
        });
      
      const formattedHistory = (await Promise.all(formattedHistoryPromises)).join('\n');
      const internalFormat = await formatInternal(filteredHistory, chatId);
      
      return {
        success: true,
        data: `היסטוריה של ${filteredHistory.length} הודעות אחרונות:\n\n${formattedHistory}`,
        messages: internalFormat,
        formatted: formattedHistory
      };
    } else {
      // Internal format (default)
      return {
        success: true,
        data: `היסטוריה של ${filteredHistory.length} הודעות אחרונות`,
        messages: await formatInternal(filteredHistory, chatId),
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
    
    // No fallback to DB - DB doesn't contain full history
    // Only contains old commands, which is not useful for full history
    return {
      success: false,
      error: `שגיאה בשליפת היסטוריית השיחה: ${errorMessage}`,
      messages: [],
      formatted: ''
    };
  }
}

/**
 * Format history to internal format
 * @param history - Green API history array
 * @param chatId - Chat ID
 * @returns Internal format messages
 */
export async function formatInternal(history: GreenApiMessage[], chatId: string): Promise<InternalMessage[]> {
  const formatted: InternalMessage[] = [];
  for (const msg of history) {
    const isFromBot = msg.idMessage ? await conversationManager.isBotMessage(chatId, msg.idMessage) : false;
    
    const textContent = msg.textMessage || 
                      msg.caption || 
                      (msg.extendedTextMessage && msg.extendedTextMessage.text) ||
                      (msg.typeMessage === 'extendedTextMessage' && msg.extendedTextMessage?.text);
    
    const metadata: InternalMessage['metadata'] = {};
    if (msg.typeMessage === 'imageMessage' || msg.typeMessage === 'image') {
      metadata.hasImage = true;
      metadata.imageUrl = msg.downloadUrl || msg.urlFile || msg.imageMessageData?.downloadUrl;
    }
    if (msg.typeMessage === 'videoMessage' || msg.typeMessage === 'video') {
      metadata.hasVideo = true;
      metadata.videoUrl = msg.downloadUrl || msg.urlFile || msg.videoMessageData?.downloadUrl;
    }
    if (msg.typeMessage === 'audioMessage' || msg.typeMessage === 'audio') {
      metadata.hasAudio = true;
      metadata.audioUrl = msg.downloadUrl || msg.urlFile || msg.audioMessageData?.downloadUrl;
    }
    
    formatted.push({
      role: isFromBot ? 'assistant' : 'user',
      content: textContent || '',
      metadata: Object.keys(metadata).length > 0 ? metadata : {},
      timestamp: msg.timestamp || Date.now()
    });
  }
  return formatted;
}

/**
 * Get raw chat history from Green API (for services that need GreenApiMessage[] format)
 * This is a convenience function that uses the SSOT getChatHistory but returns raw format
 * @param chatId - Chat ID
 * @param limit - Number of messages to retrieve
 * @param includeSystemMessages - Whether to include system messages
 * @returns Raw Green API messages array
 */
export async function getRawChatHistory(
  chatId: string,
  limit: number = 20,
  includeSystemMessages: boolean = false
): Promise<GreenApiMessage[]> {
  try {
    const { greenApiService } = getServices();
    logger.debug(`📜 [ChatHistory] Fetching raw last ${limit} messages from Green API for chat: ${chatId}`);
    
    const greenApiHistory = await greenApiService.getChatHistory(chatId, limit) as GreenApiMessage[];
    
    if (!greenApiHistory || greenApiHistory.length === 0) {
      return [];
    }
    
    // Filter system messages if needed
    if (!includeSystemMessages) {
      return greenApiHistory.filter(msg => {
        const isSystemMessage = 
          msg.typeMessage === 'notificationMessage' ||
          msg.type === 'notification' ||
          (msg.textMessage && msg.textMessage.startsWith('System:'));
        return !isSystemMessage;
      });
    }
    
    return greenApiHistory;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ [ChatHistory] Error fetching raw chat history from Green API:', {
      error: errorMessage,
      chatId
    });
    throw error;
  }
}

