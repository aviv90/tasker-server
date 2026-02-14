/**
 * WhatsApp Media Extraction Service
 * 
 * Centralized logic for extracting media URLs from messages and quoted messages.
 * Consolidated from incoming/mediaHandling.ts and quotedMessageHandler.ts
 */

import logger from '../../utils/logger';
import { MessageData } from './types';
import * as greenApiService from '../greenApiService';
import { getStaticFileUrl } from '../../utils/urlUtils';
import { saveBufferToTempFile } from '../../utils/tempFileUtils';
import axios from 'axios';

/**
 * Check if a URL is reachable (returns 200 OK)
 */
async function isValidUrl(url: string): Promise<boolean> {
    try {
        await axios.head(url, { timeout: 5000 });
        return true;
    } catch (error) {
        logger.debug(`❌ URL validation failed: ${url.substring(0, 50)}...`, { error: (error as Error).message });
        return false;
    }
}

export interface MediaUrls {
    hasImage: boolean;
    hasVideo: boolean;
    hasAudio: boolean;
    imageUrl: string | null;
    videoUrl: string | null;
    audioUrl: string | null;
}

interface GreenApiMessage {
    downloadUrl?: string;
    fileMessageData?: { downloadUrl?: string };
    imageMessageData?: { downloadUrl?: string };
    videoMessageData?: { downloadUrl?: string };
    audioMessageData?: { downloadUrl?: string };
    documentMessageData?: { downloadUrl?: string };
    stickerMessageData?: { downloadUrl?: string };
    messageData?: {
        fileMessageData?: { downloadUrl?: string };
        imageMessageData?: { downloadUrl?: string };
        videoMessageData?: { downloadUrl?: string };
        audioMessageData?: { downloadUrl?: string };
        documentMessageData?: { downloadUrl?: string };
        stickerMessageData?: { downloadUrl?: string };
    };
    [key: string]: unknown;
}

/**
 * Check if this is an actual quoted message (reply) vs media with caption
 */
export function isActualQuote(messageData: MessageData, quotedMessage: MessageData | undefined): boolean {
    if (messageData.typeMessage !== 'quotedMessage' || !quotedMessage || !quotedMessage.stanzaId) {
        return false;
    }

    const quotedCaption = quotedMessage?.caption;
    const extractedText = messageData.extendedTextMessageData?.text;

    // Check if caption matches text (exact match OR caption starts with text, covering "# " case)
    const captionMatchesText = !!(quotedCaption && extractedText &&
        (quotedCaption === extractedText ||
            quotedCaption.startsWith(extractedText) ||
            extractedText.startsWith(quotedCaption)));

    return !captionMatchesText; // It's a quote if text doesn't match caption
}

/**
 * Extract media URLs from direct media messages
 */
export function extractDirectMediaUrls(messageData: MessageData): MediaUrls {
    const hasImage = messageData.typeMessage === 'imageMessage' || messageData.typeMessage === 'stickerMessage';
    const hasVideo = messageData.typeMessage === 'videoMessage';
    const hasAudio = messageData.typeMessage === 'audioMessage';

    let imageUrl: string | null = null;
    let videoUrl: string | null = null;
    let audioUrl: string | null = null;

    if (hasImage) {
        imageUrl = messageData.downloadUrl ||
            messageData.fileMessageData?.downloadUrl ||
            messageData.imageMessageData?.downloadUrl ||
            messageData.stickerMessageData?.downloadUrl || null;
    } else if (hasVideo) {
        videoUrl = messageData.downloadUrl ||
            messageData.fileMessageData?.downloadUrl ||
            messageData.videoMessageData?.downloadUrl || null;
    } else if (hasAudio) {
        audioUrl = messageData.downloadUrl ||
            messageData.fileMessageData?.downloadUrl ||
            messageData.audioMessageData?.downloadUrl || null;
    }

    return { hasImage, hasVideo, hasAudio, imageUrl, videoUrl, audioUrl };
}

/**
 * Fetch media URL from Green API if not found in webhook
 */
export async function fetchMediaUrlFromAPI(chatId: string, messageId: string, mediaType: string): Promise<string | null> {
    logger.debug(`📨 Fetching message ${messageId} from chat ${chatId} for ${mediaType} URL`);
    try {
        const originalMessage = await greenApiService.getMessage(chatId, messageId) as GreenApiMessage | null;
        if (!originalMessage) return null;

        if (mediaType === 'image' || mediaType === 'sticker') {
            return originalMessage.downloadUrl ||
                originalMessage.fileMessageData?.downloadUrl ||
                originalMessage.imageMessageData?.downloadUrl ||
                originalMessage.stickerMessageData?.downloadUrl ||
                originalMessage.messageData?.fileMessageData?.downloadUrl ||
                originalMessage.messageData?.imageMessageData?.downloadUrl ||
                originalMessage.messageData?.stickerMessageData?.downloadUrl ||
                null;
        } else if (mediaType === 'video') {
            return originalMessage.downloadUrl ||
                originalMessage.fileMessageData?.downloadUrl ||
                originalMessage.videoMessageData?.downloadUrl ||
                originalMessage.messageData?.fileMessageData?.downloadUrl ||
                originalMessage.messageData?.videoMessageData?.downloadUrl ||
                null;
        } else if (mediaType === 'audio') {
            return originalMessage.downloadUrl ||
                originalMessage.fileMessageData?.downloadUrl ||
                originalMessage.audioMessageData?.downloadUrl ||
                originalMessage.messageData?.fileMessageData?.downloadUrl ||
                originalMessage.messageData?.audioMessageData?.downloadUrl ||
                // Fallback for audio sent as documents
                originalMessage.documentMessageData?.downloadUrl ||
                originalMessage.messageData?.documentMessageData?.downloadUrl ||
                null;
        }
        return null;
    } catch (err: any) {
        logger.warn(`⚠️ Failed to fetch ${mediaType} downloadUrl via getMessage: ${err.message}`);
        return null;
    }
}

/**
 * Extract media URLs from a quoted message (used for both actual quotes and captioned media)
 * Implements fallback logic: Webhook -> API -> Thumbnail
 */
export async function extractQuotedMediaUrls(quotedMessage: MessageData, chatId: string, currentMessageId?: string): Promise<MediaUrls> {
    const hasImage = quotedMessage.typeMessage === 'imageMessage' || quotedMessage.typeMessage === 'stickerMessage';
    const hasVideo = quotedMessage.typeMessage === 'videoMessage';
    const hasAudio = quotedMessage.typeMessage === 'audioMessage';
    // Add support for audio documents
    const hasDocument = quotedMessage.typeMessage === 'documentMessage';
    const isAudioDocument = hasDocument && quotedMessage.mimetype?.startsWith('audio/');

    let imageUrl: string | null = null;
    let videoUrl: string | null = null;
    let audioUrl: string | null = null;

    if (!hasImage && !hasVideo && !hasAudio && !isAudioDocument) {
        return { hasImage: false, hasVideo: false, hasAudio: false, imageUrl: null, videoUrl: null, audioUrl: null };
    }

    // STEP 1: Try to extract directly from quotedMessage
    if (hasImage) {
        imageUrl = quotedMessage.downloadUrl ||
            quotedMessage.fileMessageData?.downloadUrl ||
            quotedMessage.imageMessageData?.downloadUrl ||
            quotedMessage.stickerMessageData?.downloadUrl || null;
    } else if (hasVideo) {
        videoUrl = quotedMessage.downloadUrl ||
            quotedMessage.fileMessageData?.downloadUrl ||
            quotedMessage.videoMessageData?.downloadUrl || null;
    } else if (hasAudio) {
        audioUrl = quotedMessage.downloadUrl ||
            quotedMessage.fileMessageData?.downloadUrl ||
            quotedMessage.audioMessageData?.downloadUrl || null;
    } else if (isAudioDocument) {
        // Handle document as audio
        audioUrl = quotedMessage.downloadUrl ||
            quotedMessage.fileMessageData?.downloadUrl ||
            quotedMessage.documentMessageData?.downloadUrl || null;
    }

    // VALIDATION STEP: Check if the extracted URL is actually valid/reachable
    // Quoted message URLs might be expired. If they return 404, we should treat them as null
    // so we fall back to fetching the fresh message data.
    if (imageUrl || videoUrl || audioUrl) {
        const urlToCheck = imageUrl || videoUrl || audioUrl;
        if (urlToCheck && urlToCheck.startsWith('http')) {
            const isValid = await isValidUrl(urlToCheck);
            if (!isValid) {
                logger.warn(`⚠️ Extracted media URL from quoted message is invalid/expired (404). Falling back to API fetch.`);
                imageUrl = null;
                videoUrl = null;
                audioUrl = null;
            } else {
                logger.debug(`✅ Extracted media URL is valid (reachable)`);
            }
        }
    }

    // STEP 2: If not found, try to fetch the QUOTED message ID (if stanzaId exists)
    if ((hasImage && !imageUrl) || (hasVideo && !videoUrl) || ((hasAudio || isAudioDocument) && !audioUrl)) {
        if (quotedMessage.stanzaId) {
            const mediaType = hasImage ? 'image' : hasVideo ? 'video' : (hasAudio || isAudioDocument) ? 'audio' : 'document';
            const fetchedUrl = await fetchMediaUrlFromAPI(chatId, quotedMessage.stanzaId, mediaType);
            if (fetchedUrl) {
                if (hasImage) imageUrl = fetchedUrl;
                if (hasVideo) videoUrl = fetchedUrl;
                if (hasAudio || isAudioDocument) audioUrl = fetchedUrl;
                logger.debug(`✅ Found media URL for quoted message via getMessage (quoted ID)`);
            }
        }
    }

    // STEP 3: If still not found and we have currentMessageId (for captioned media case), try fetching current message
    if (currentMessageId && ((hasImage && !imageUrl) || (hasVideo && !videoUrl) || (hasAudio && !audioUrl))) {
        const mediaType = hasImage ? 'image' : hasVideo ? 'video' : 'audio';
        const fetchedUrl = await fetchMediaUrlFromAPI(chatId, currentMessageId, mediaType);
        if (fetchedUrl) {
            if (hasImage) imageUrl = fetchedUrl;
            if (hasVideo) videoUrl = fetchedUrl;
            if (hasAudio) audioUrl = fetchedUrl;
            logger.debug(`✅ Found media URL via getMessage (current ID)`);
        }
    }

    // STEP 4: Fallback to thumbnail (images/stickers only)
    if (hasImage && !imageUrl && quotedMessage.jpegThumbnail) {
        logger.debug(`🖼️ Using thumbnail fallback for quoted image`);
        try {
            const thumbnailBuffer = Buffer.from(quotedMessage.jpegThumbnail as string, 'base64');
            const tempFileName = `quoted_thumb_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
            const { fileName } = saveBufferToTempFile(thumbnailBuffer, tempFileName);
            imageUrl = getStaticFileUrl(`/tmp/${fileName}`);
        } catch (err: any) {
            logger.error(`❌ Thumbnail processing failed: ${err.message}`);
        }
    }

    // DEBUG: Log breakdown if media URL is missing
    if ((hasImage && !imageUrl) || (hasVideo && !videoUrl) || (hasAudio && !audioUrl)) {
        logger.warn(`❌ Failed to extract media URL for quoted message`, {
            type: quotedMessage.typeMessage,
            stanzaId: quotedMessage.stanzaId,
            keys: Object.keys(quotedMessage),
            hasDownloadUrl: !!quotedMessage.downloadUrl,
            // Log full object for debugging (truncated)
            data: JSON.stringify(quotedMessage).substring(0, 500)
        });
    }

    return { hasImage, hasVideo, hasAudio, imageUrl, videoUrl, audioUrl };
}
