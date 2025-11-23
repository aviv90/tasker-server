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

const { getServices } = require('../services/agent/utils/serviceLoader');
const conversationManager = require('../services/conversationManager');
const logger = require('./logger');

/**
 * Get chat history from Green API
 * @param {string} chatId - Chat ID
 * @param {number} limit - Number of messages to retrieve
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} - Formatted history with messages array
 */
async function getChatHistory(chatId, limit = 20, options = {}) {
  const { includeSystemMessages = false, format = 'internal' } = options;
  
  try {
    const { greenApiService } = getServices();
    logger.debug(`📜 [ChatHistory] Fetching last ${limit} messages from Green API for chat: ${chatId}`);
    
    const greenApiHistory = await greenApiService.getChatHistory(chatId, limit);
    
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
        messages: formatInternal(filteredHistory, chatId),
        formatted: ''
      };
    }
  } catch (error) {
    logger.error('❌ [ChatHistory] Error fetching chat history from Green API:', {
      error: error.message,
      chatId,
      stack: error.stack
    });
    
    // No fallback to DB - DB doesn't contain full history
    // Only contains old commands, which is not useful for full history
    return {
      success: false,
      error: `שגיאה בשליפת היסטוריית השיחה: ${error.message}`,
      messages: [],
      formatted: ''
    };
  }
}

/**
 * Format history to internal format
 * @param {Array} history - Green API history array
 * @param {string} chatId - Chat ID
 * @returns {Promise<Array>} - Internal format messages
 */
async function formatInternal(history, chatId) {
  const formatted = [];
  for (const msg of history) {
    const isFromBot = msg.idMessage ? await conversationManager.isBotMessage(chatId, msg.idMessage) : false;
    
    const textContent = msg.textMessage || 
                      msg.caption || 
                      (msg.extendedTextMessage && msg.extendedTextMessage.text) ||
                      (msg.typeMessage === 'extendedTextMessage' && msg.extendedTextMessage?.text);
    
    const metadata = {};
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

module.exports = {
  getChatHistory,
  formatInternal
};

