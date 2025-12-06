/**
 * Message Parser
 * 
 * Parses WhatsApp message data to extract text and media information.
 * Extracted from outgoingHandler.js for better modularity (SRP).
 */

import logger from '../../utils/logger';
import { MessageData } from '../../services/whatsapp/types';


/**
 * Extract message text from various message types
 * @param {Object} messageData - Message data from Green API webhook
 * @returns {string|null} - Extracted message text or null
 */
export function extractMessageText(messageData: MessageData): string | null {
  if (!messageData || !messageData.typeMessage) {
    return null;
  }

  let messageText: string | undefined | null = null;

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

  return messageText || null;
}



/**
 * Build quoted context for Agent
 * @param {Object} quotedMessage - Quoted message data
 * @param {string} imageUrl - Image URL (if available)
 * @param {string} videoUrl - Video URL (if available)
 * @param {string} audioUrl - Audio URL (if available)
 * @returns {Object|null} - Quoted context object or null
 */
export function buildQuotedContext(quotedMessage: MessageData, imageUrl?: string | null, videoUrl?: string | null, audioUrl?: string | null) {
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
 * Log message details for debugging
 * @param {Object} messageData - Message data from Green API webhook
 * @param {string} senderName - Sender name
 * @param {string} messageText - Extracted message text
 * @param {string} direction - 'Incoming' or 'Outgoing' (default: 'Outgoing')
 */
export function logMessageDetails(messageData: MessageData, senderName: string, messageText: string | null, direction: 'Incoming' | 'Outgoing' = 'Outgoing') {
  const icon = direction === 'Incoming' ? '📱' : '📤';
  const logFn = direction === 'Incoming' ? logger.info.bind(logger) : logger.debug.bind(logger);

  logFn(`${icon} ${direction} from ${senderName} | Type: ${messageData.typeMessage}${messageData.typeMessage === 'editedMessage' ? ' ✏️' : ''}`);

  if (messageText) {
    logFn(`   Text: ${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}`);
  }

  if (messageData.typeMessage === 'imageMessage') {
    const caption = messageData.fileMessageData?.caption || messageData.imageMessageData?.caption;
    logFn(`   Image Caption: ${caption || 'N/A'}`);
  }

  if (messageData.typeMessage === 'stickerMessage') {
    const caption = messageData.fileMessageData?.caption;
    logFn(`   Sticker Caption: ${caption || 'N/A'} (treating as image)`);
  }

  if (messageData.typeMessage === 'videoMessage') {
    const caption = messageData.fileMessageData?.caption || messageData.videoMessageData?.caption;
    logFn(`   Video Caption: ${caption || 'N/A'}`);
  }

  if (messageData.typeMessage === 'quotedMessage' && messageData.quotedMessage) {
    logFn(`   Quoted Message Type: ${messageData.quotedMessage.typeMessage}`);
    if (messageData.quotedMessage.textMessageData?.textMessage) {
      logFn(`   Quoted Text: ${messageData.quotedMessage.textMessageData.textMessage.substring(0, 50)}...`);
    }
    if (messageData.quotedMessage.caption) {
      logFn(`   Quoted Caption: ${messageData.quotedMessage.caption.substring(0, 50)}...`);
    }
  }
}
