/**
 * Message Parser
 * 
 * Parses WhatsApp message data to extract text and media information.
 * Extracted from outgoingHandler.js for better modularity (SRP).
 */

import logger from '../../utils/logger';

/**
 * Extract message text from various message types
 * @param {Object} messageData - Message data from Green API webhook
 * @returns {string|null} - Extracted message text or null
 */
export function extractMessageText(messageData: any): string | null {
  if (!messageData || !messageData.typeMessage) {
    return null;
  }

  let messageText = null;

  if (messageData.typeMessage === 'textMessage') {
    messageText = messageData.textMessageData?.textMessage;
  } else if (messageData.typeMessage === 'extendedTextMessage') {
    messageText = messageData.extendedTextMessageData?.text;
  } else if (messageData.typeMessage === 'quotedMessage') {
    // When replying to a message, the text is in extendedTextMessageData
    messageText = messageData.extendedTextMessageData?.text;
    // BUT: If this is actually an image/video/sticker with caption (not a reply), extract the caption
    if (!messageText) {
      messageText = messageData.fileMessageData?.caption || 
                   messageData.imageMessageData?.caption || 
                   messageData.videoMessageData?.caption ||
                   messageData.stickerMessageData?.caption;
    }
  } else if (messageData.typeMessage === 'editedMessage') {
    // Handle edited messages - treat them as regular messages
    messageText = messageData.editedMessageData?.textMessage;
  } else if (messageData.typeMessage === 'imageMessage') {
    // Extract caption from image messages
    messageText = messageData.fileMessageData?.caption || messageData.imageMessageData?.caption;
  } else if (messageData.typeMessage === 'videoMessage') {
    // Extract caption from video messages
    messageText = messageData.fileMessageData?.caption || messageData.videoMessageData?.caption;
  } else if (messageData.typeMessage === 'stickerMessage') {
    // Extract caption from sticker messages (rare but possible)
    messageText = messageData.fileMessageData?.caption || messageData.stickerMessageData?.caption;
  }

  return messageText;
}

/**
 * Extract media URLs from message data
 * @param {Object} messageData - Message data from Green API webhook
 * @returns {Object} - Object with imageUrl, videoUrl, audioUrl
 */
export function extractMediaUrls(messageData: any) {
  const result: { imageUrl: string | null; videoUrl: string | null; audioUrl: string | null } = {
    imageUrl: null,
    videoUrl: null,
    audioUrl: null
  };

  if (!messageData) {
    return result;
  }

  // Extract URLs for direct media messages (imageMessage/videoMessage/audioMessage)
  if (messageData.typeMessage === 'imageMessage' || messageData.typeMessage === 'stickerMessage') {
    result.imageUrl = messageData.downloadUrl || 
                     messageData.fileMessageData?.downloadUrl || 
                     messageData.imageMessageData?.downloadUrl ||
                     messageData.stickerMessageData?.downloadUrl;
  } else if (messageData.typeMessage === 'videoMessage') {
    result.videoUrl = messageData.downloadUrl || 
                     messageData.fileMessageData?.downloadUrl || 
                     messageData.videoMessageData?.downloadUrl;
  } else if (messageData.typeMessage === 'audioMessage') {
    result.audioUrl = messageData.downloadUrl || 
                     messageData.fileMessageData?.downloadUrl || 
                     messageData.audioMessageData?.downloadUrl;
  }

  return result;
}

/**
 * Extract media URLs from quoted message (media with caption, not actual quote)
 * Tries multiple locations and falls back to getMessage API if needed
 * @param {Object} messageData - Message data from Green API webhook
 * @param {Object} quotedMessage - Quoted message data
 * @param {string} chatId - Chat ID for getMessage fallback
 * @param {string} messageId - Message ID for getMessage fallback
 * @param {Function} getMessageFn - Function to fetch message via API (optional)
 * @returns {Promise<Object>} - Object with imageUrl, videoUrl, audioUrl, hasImage, hasVideo, hasAudio
 */
export async function extractQuotedMediaUrls(
    messageData: any, 
    webhookData: any, // Contains chatId and idMessage
    _chatId?: string // Optional, can use webhookData
    // getMessageFn is removed as we import greenApiService directly or pass it if needed, but to match JS logic we'll import it or use a callback if provided. 
    // Actually JS version used a callback. Let's see usage.
) {
  // The JS version accepted getMessageFn. We should probably import getMessage from service here to avoid circular deps if possible, or keep accepting it.
  // However, to keep signature clean in TS, let's import greenApiService if we can, or dynamic import.
  // But messageParser is a utility. Let's assume the caller handles fetching if needed? 
  // No, the logic explicitly calls getMessageFn.
  
  // Let's import greenApiService here dynamically or use the one from arguments if we change signature.
  // In JS it was `extractQuotedMediaUrls(messageData, quotedMessage, chatId, messageId, getMessageFn)`.
  // Let's stick to that or similar.
  
  // Checking outgoingHandler.js:
  // const quotedMedia = await extractQuotedMediaUrls(
  //   messageData, 
  //   quotedMessage, 
  //   chatId, 
  //   webhookData.idMessage,
  //   greenApiService.getMessage.bind(greenApiService)
  // );
  
  // So we should keep the signature.
  
  return extractQuotedMediaUrlsWithCallback(messageData, webhookData.messageData?.quotedMessage, webhookData.senderData?.chatId, webhookData.idMessage);
}

// Helper to avoid import cycles and match JS logic slightly better adapted
async function extractQuotedMediaUrlsWithCallback(messageData: any, quotedMessage: any, chatId: string, messageId: string) {
    const result = {
    imageUrl: null as string | null,
    videoUrl: null as string | null,
    audioUrl: null as string | null,
    hasImage: false,
    hasVideo: false,
    hasAudio: false
  };

  if (!quotedMessage) {
    return result;
  }

  const quotedType = quotedMessage.typeMessage;
  
  // We need getMessage. Let's import it dynamically to avoid circular dependency issues if any
  const { getMessage } = await import('../../services/greenApiService');

  if (quotedType === 'imageMessage' || quotedType === 'stickerMessage') {
    result.hasImage = true;
    // Try all possible locations for downloadUrl
    result.imageUrl = messageData.downloadUrl || 
                      messageData.fileMessageData?.downloadUrl || 
                      messageData.imageMessageData?.downloadUrl ||
                      messageData.stickerMessageData?.downloadUrl ||
                      quotedMessage.downloadUrl ||
                      quotedMessage.fileMessageData?.downloadUrl ||
                      quotedMessage.imageMessageData?.downloadUrl ||
                      quotedMessage.stickerMessageData?.downloadUrl;
    
    // If still not found, try getMessage to fetch the current message's downloadUrl
    if (!result.imageUrl && chatId && messageId) {
      logger.debug('⚠️ Outgoing: downloadUrl not found in webhook, fetching from Green API...');
      try {
        const originalMessage = await getMessage(chatId, messageId);
        result.imageUrl = originalMessage?.downloadUrl || 
                         originalMessage?.fileMessageData?.downloadUrl || 
                         originalMessage?.imageMessageData?.downloadUrl;
        logger.debug(`✅ Outgoing: downloadUrl fetched from getMessage: ${result.imageUrl ? 'found' : 'still NOT FOUND'}`);
      } catch (err: any) {
        logger.error(`❌ Outgoing: Failed to fetch downloadUrl via getMessage:`, { error: err.message, stack: err.stack });
      }
    }
    logger.debug(`📸 Outgoing: Image with caption detected, final downloadUrl: ${result.imageUrl ? 'found' : 'NOT FOUND'}`);
  } else if (quotedType === 'videoMessage') {
    result.hasVideo = true;
    result.videoUrl = messageData.downloadUrl || 
                     messageData.fileMessageData?.downloadUrl || 
                     messageData.videoMessageData?.downloadUrl ||
                     quotedMessage.downloadUrl ||
                     quotedMessage.fileMessageData?.downloadUrl ||
                     quotedMessage.videoMessageData?.downloadUrl;
    
    // If still not found, try getMessage to fetch the current message's downloadUrl
    if (!result.videoUrl && chatId && messageId) {
      logger.debug('⚠️ Outgoing: Video downloadUrl not found in webhook, fetching from Green API...');
      try {
        const originalMessage = await getMessage(chatId, messageId);
        result.videoUrl = originalMessage?.downloadUrl || 
                         originalMessage?.fileMessageData?.downloadUrl || 
                         originalMessage?.videoMessageData?.downloadUrl;
        logger.debug(`✅ Outgoing: Video downloadUrl fetched from getMessage: ${result.videoUrl ? 'found' : 'still NOT FOUND'}`);
      } catch (err: any) {
        logger.error(`❌ Outgoing: Failed to fetch video downloadUrl via getMessage:`, { error: err.message, stack: err.stack });
      }
    }
    logger.debug(`🎥 Outgoing: Video with caption detected, final downloadUrl: ${result.videoUrl ? 'found' : 'NOT FOUND'}`);
  }

  return result;
}

/**
 * Build quoted context for Agent
 * @param {Object} quotedMessage - Quoted message data
 * @param {string} imageUrl - Image URL (if available)
 * @param {string} videoUrl - Video URL (if available)
 * @param {string} audioUrl - Audio URL (if available)
 * @returns {Object|null} - Quoted context object or null
 */
export function buildQuotedContext(quotedMessage: any, imageUrl?: string | null, videoUrl?: string | null, audioUrl?: string | null) {
  if (!quotedMessage) {
    return null;
  }

  return {
    type: quotedMessage.typeMessage || 'unknown',
    text: quotedMessage.textMessage || quotedMessage.caption || '',
    hasImage: quotedMessage.typeMessage === 'imageMessage' || quotedMessage.typeMessage === 'stickerMessage',
    hasVideo: quotedMessage.typeMessage === 'videoMessage',
    hasAudio: quotedMessage.typeMessage === 'audioMessage',
    imageUrl: imageUrl || null,
    videoUrl: videoUrl || null,
    audioUrl: audioUrl || null,
    stanzaId: quotedMessage.stanzaId
  };
}

/**
 * Check if message is an actual quote (reply) vs media with caption
 * @param {Object} messageData - Message data from Green API webhook
 * @returns {boolean} - True if this is an actual quote
 */
export function isActualQuote(messageData: any, quotedMessage: any = null) { // Added quotedMessage param to match usage
  // Use provided quotedMessage or fallback to messageData.quotedMessage
  const actualQuotedMessage = quotedMessage || messageData.quotedMessage;
  
  if (!actualQuotedMessage || messageData.typeMessage !== 'quotedMessage') {
    return false;
  }

  // IMPORTANT: Green API sends images/videos with captions as quotedMessage, but they're NOT actual quotes!
  // Check if this is a REAL quote (reply) or just a media message with caption
  const quotedCaption = actualQuotedMessage?.caption;
  const extractedText = messageData.extendedTextMessageData?.text;
  
  // Check if caption matches text (exact match OR caption starts with text, covering "# מה זה..." case)
  const captionMatchesText = quotedCaption && extractedText && 
                            (quotedCaption === extractedText || 
                             quotedCaption.startsWith(extractedText) ||
                             extractedText.startsWith(quotedCaption));
  
  // It's a quote if text doesn't match caption
  return actualQuotedMessage.stanzaId && extractedText && !captionMatchesText;
}

/**
 * Log message details for debugging
 * @param {Object} messageData - Message data from Green API webhook
 * @param {string} senderName - Sender name
 * @param {string} messageText - Extracted message text
 */
export function logMessageDetails(messageData: any, senderName: string, messageText: string | null) {
  logger.debug(`📤 Outgoing from ${senderName}:`);
  logger.debug(`   Message Type: ${messageData.typeMessage}${messageData.typeMessage === 'editedMessage' ? ' ✏️' : ''}`);
  logger.debug(`   messageText extracted: ${messageText ? `"${messageText.substring(0, 100)}"` : 'NULL/UNDEFINED'}`);
  
  if (messageText) {
    logger.debug(`   Text: ${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}`);
  }
  
  if (messageData.typeMessage === 'imageMessage') {
    const caption = messageData.fileMessageData?.caption || messageData.imageMessageData?.caption;
    logger.debug(`   Image Caption: ${caption || 'N/A'}`);
  }
  
  if (messageData.typeMessage === 'stickerMessage') {
    const caption = messageData.fileMessageData?.caption;
    logger.debug(`   Sticker Caption: ${caption || 'N/A'} (treating as image)`);
  }
  
  if (messageData.typeMessage === 'videoMessage') {
    const caption = messageData.fileMessageData?.caption || messageData.videoMessageData?.caption;
    logger.debug(`   Video Caption: ${caption || 'N/A'}`);
  }
  
  if (messageData.typeMessage === 'quotedMessage' && messageData.quotedMessage) {
    logger.debug(`   Quoted Message Type: ${messageData.quotedMessage.typeMessage}`);
    if (messageData.quotedMessage.textMessage) {
      logger.debug(`   Quoted Text: ${messageData.quotedMessage.textMessage.substring(0, 50)}...`);
    }
    if (messageData.quotedMessage.caption) {
      logger.debug(`   Quoted Caption: ${messageData.quotedMessage.caption.substring(0, 50)}...`);
    }
  }
}
