/**
 * Incoming Message Media Handling
 * 
 * Handles media extraction, URLs, and quoted message processing
 */

import { handleQuotedMessage } from '../quotedMessageHandler';
import * as greenApiService from '../../../services/greenApiService';

interface MediaUrls {
    hasImage: boolean;
    hasVideo: boolean;
    hasAudio: boolean;
    imageUrl: string | null;
    videoUrl: string | null;
    audioUrl: string | null;
}

/**
 * Check if this is an actual quoted message (reply) vs media with caption
 * @param {Object} messageData - Message data
 * @param {Object} quotedMessage - Quoted message data
 * @returns {boolean} True if actual quote, false otherwise
 */
export function isActualQuote(messageData: any, quotedMessage: any): boolean {
  if (messageData.typeMessage !== 'quotedMessage' || !quotedMessage || !quotedMessage.stanzaId) {
    return false;
  }

  const quotedCaption = quotedMessage?.caption;
  const extractedText = messageData.extendedTextMessageData?.text;
  // Check if caption matches text (exact match OR caption starts with text, covering "# מה זה..." case)
  const captionMatchesText = quotedCaption && extractedText &&
    (quotedCaption === extractedText ||
      quotedCaption.startsWith(extractedText) ||
      extractedText.startsWith(quotedCaption));

  return !captionMatchesText; // It's a quote if text doesn't match caption
}

/**
 * Extract media URLs from direct media messages
 * @param {Object} messageData - Message data
 * @returns {Object} Media info with URLs and flags
 */
export function extractDirectMediaUrls(messageData: any): MediaUrls {
  let hasImage = messageData.typeMessage === 'imageMessage' || messageData.typeMessage === 'stickerMessage';
  let hasVideo = messageData.typeMessage === 'videoMessage';
  let hasAudio = messageData.typeMessage === 'audioMessage';
  let imageUrl = null;
  let videoUrl = null;
  let audioUrl = null;

  // Extract URLs for direct media messages (imageMessage/videoMessage/audioMessage)
  if (messageData.typeMessage === 'imageMessage' || messageData.typeMessage === 'stickerMessage') {
    imageUrl = messageData.downloadUrl ||
      messageData.fileMessageData?.downloadUrl ||
      messageData.imageMessageData?.downloadUrl ||
      messageData.stickerMessageData?.downloadUrl;
    console.log(`📸 Incoming: Direct image message, downloadUrl: ${imageUrl ? 'found' : 'NOT FOUND'}`);
  } else if (messageData.typeMessage === 'videoMessage') {
    videoUrl = messageData.downloadUrl ||
      messageData.fileMessageData?.downloadUrl ||
      messageData.videoMessageData?.downloadUrl;
    console.log(`🎥 Incoming: Direct video message, downloadUrl: ${videoUrl ? 'found' : 'NOT FOUND'}`);
  } else if (messageData.typeMessage === 'audioMessage') {
    audioUrl = messageData.downloadUrl ||
      messageData.fileMessageData?.downloadUrl ||
      messageData.audioMessageData?.downloadUrl;
    console.log(`🎵 Incoming: Direct audio message, downloadUrl: ${audioUrl ? 'found' : 'NOT FOUND'}`);
  }

  return {
    hasImage,
    hasVideo,
    hasAudio,
    imageUrl,
    videoUrl,
    audioUrl
  };
}

/**
 * Fetch media URL from Green API if not found in webhook
 * @param {string} chatId - Chat ID
 * @param {string} messageId - Message ID
 * @param {string} mediaType - Media type ('image', 'video', 'audio')
 * @returns {Promise<string|null>} Media URL or null
 */
interface GreenApiMessage {
  downloadUrl?: string;
  fileMessageData?: { downloadUrl?: string };
  imageMessageData?: { downloadUrl?: string };
  videoMessageData?: { downloadUrl?: string };
  audioMessageData?: { downloadUrl?: string };
  [key: string]: unknown;
}

export async function fetchMediaUrlFromAPI(chatId: string, messageId: string, mediaType: string): Promise<string | null> {
  console.log(`⚠️ ${mediaType} downloadUrl not found in webhook, fetching from Green API...`);
  try {
    const originalMessage = await greenApiService.getMessage(chatId, messageId) as GreenApiMessage | null;
    if (!originalMessage) return null;

    if (mediaType === 'image') {
      return originalMessage?.downloadUrl ||
        originalMessage?.fileMessageData?.downloadUrl ||
        originalMessage?.imageMessageData?.downloadUrl ||
        null;
    } else if (mediaType === 'video') {
      return originalMessage?.downloadUrl ||
        originalMessage?.fileMessageData?.downloadUrl ||
        originalMessage?.videoMessageData?.downloadUrl ||
        null;
    } else if (mediaType === 'audio') {
      return originalMessage?.downloadUrl ||
        originalMessage?.fileMessageData?.downloadUrl ||
        originalMessage?.audioMessageData?.downloadUrl ||
        null;
    }
    return null;
  } catch (err: any) {
    console.log(`❌ Failed to fetch ${mediaType} downloadUrl via getMessage: ${err.message}`);
    return null;
  }
}

/**
 * Extract media URLs from quoted message (media with caption, not actual quote)
 * @param {Object} messageData - Message data
 * @param {Object} webhookData - Full webhook data
 * @param {string} chatId - Chat ID
 * @returns {Promise<Object>} Media info with URLs
 */
export async function extractQuotedMediaUrls(messageData: any, webhookData: any, chatId: string): Promise<MediaUrls> {
  const quotedMessage = messageData.quotedMessage;
  if (!quotedMessage) {
    return { hasImage: false, hasVideo: false, hasAudio: false, imageUrl: null, videoUrl: null, audioUrl: null };
  }

  console.log(`📸 Media message with caption (not a quote) - Type: ${quotedMessage.typeMessage || 'unknown'}`);

  let hasImage = false;
  let hasVideo = false;
  let hasAudio = false;
  let imageUrl = null;
  let videoUrl = null;
  let audioUrl = null;

  if (quotedMessage.typeMessage === 'imageMessage' || quotedMessage.typeMessage === 'stickerMessage') {
    hasImage = true;
    // Try all possible locations for downloadUrl
    imageUrl = messageData.downloadUrl ||
      messageData.fileMessageData?.downloadUrl ||
      messageData.imageMessageData?.downloadUrl ||
      messageData.stickerMessageData?.downloadUrl ||
      quotedMessage.downloadUrl ||
      quotedMessage.fileMessageData?.downloadUrl ||
      quotedMessage.imageMessageData?.downloadUrl ||
      quotedMessage.stickerMessageData?.downloadUrl;

    // If still not found, try getMessage to fetch the current message's downloadUrl
    if (!imageUrl) {
      const fetchedUrl = await fetchMediaUrlFromAPI(chatId, webhookData.idMessage, 'image');
      if (fetchedUrl) {
        imageUrl = fetchedUrl;
        console.log(`✅ downloadUrl fetched from getMessage: found`);
      } else {
        console.log(`✅ downloadUrl fetched from getMessage: still NOT FOUND`);
      }
    }
    console.log(`📸 Image with caption detected, final downloadUrl: ${imageUrl ? 'found' : 'NOT FOUND'}`);
  } else if (quotedMessage.typeMessage === 'videoMessage') {
    hasVideo = true;
    videoUrl = messageData.downloadUrl ||
      messageData.fileMessageData?.downloadUrl ||
      messageData.videoMessageData?.downloadUrl ||
      quotedMessage.downloadUrl ||
      quotedMessage.fileMessageData?.downloadUrl ||
      quotedMessage.videoMessageData?.downloadUrl;

    // If still not found, try getMessage to fetch the current message's downloadUrl
    if (!videoUrl) {
      const fetchedUrl = await fetchMediaUrlFromAPI(chatId, webhookData.idMessage, 'video');
      if (fetchedUrl) {
        videoUrl = fetchedUrl;
        console.log(`✅ Video downloadUrl fetched from getMessage: found`);
      } else {
        console.log(`✅ Video downloadUrl fetched from getMessage: still NOT FOUND`);
      }
    }
    console.log(`🎥 Video with caption detected, final downloadUrl: ${videoUrl ? 'found' : 'NOT FOUND'}`);
  }

  return { hasImage, hasVideo, hasAudio, imageUrl, videoUrl, audioUrl };
}

/**
 * Process quoted message and merge content
 * @param {Object} quotedMessage - Quoted message data
 * @param {string} basePrompt - Base prompt from user
 * @param {string} chatId - Chat ID
 * @returns {Promise<Object>} Merged prompt and media info
 */
export async function processQuotedMessage(quotedMessage: any, basePrompt: string, chatId: string) {
  console.log(`🔗 Detected quoted message with stanzaId: ${quotedMessage.stanzaId}`);

  // Handle quoted message - merge content
  const quotedResult = await handleQuotedMessage(quotedMessage, basePrompt, chatId);

  // Check if there was an error processing the quoted message
  if (quotedResult.error) {
    return { error: quotedResult.error };
  }

  return {
    prompt: quotedResult.prompt,
    hasImage: quotedResult.hasImage,
    hasVideo: quotedResult.hasVideo,
    hasAudio: quotedResult.hasAudio,
    imageUrl: quotedResult.imageUrl,
    videoUrl: quotedResult.videoUrl,
    audioUrl: quotedResult.audioUrl
  };
}

/**
 * Build quoted context object for Agent
 * @param {Object} quotedMessage - Quoted message data
 * @param {string} imageUrl - Image URL
 * @param {string} videoUrl - Video URL
 * @param {string} audioUrl - Audio URL
 * @returns {Object} Quoted context object
 */
export function buildQuotedContext(quotedMessage: any, imageUrl?: string | null, videoUrl?: string | null, audioUrl?: string | null) {
  if (!quotedMessage) return null;

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
