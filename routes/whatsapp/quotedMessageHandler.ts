/**
 * Quoted Message Handler
 * 
 * Handles processing of quoted/replied messages in WhatsApp.
 * Extracted from whatsappRoutes.js (Phase 4.6)
 */

import { MessageData } from '../../services/whatsapp/types';
import logger from '../../utils/logger';
import { isCommand, extractCommandPrompt } from '../../utils/commandUtils';

interface QuotedResult {
  hasImage: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  prompt: string;
  imageUrl: string | null;
  videoUrl: string | null;
  audioUrl: string | null;
  error?: string;
}

export async function handleQuotedMessage(quotedMessage: MessageData, currentPrompt: string, chatId: string): Promise<QuotedResult> {
  try {
    logger.debug(`🔗 Processing quoted message: ${quotedMessage.stanzaId}`);

    // Extract quoted message type and content
    const quotedType = quotedMessage.typeMessage;

    // For text messages, combine both texts
    if (quotedType === 'textMessage' || quotedType === 'extendedTextMessage') {
      const quotedText = quotedMessage.textMessage || quotedMessage.textMessageData?.textMessage || quotedMessage.extendedTextMessageData?.text || '';
      const combinedPrompt = `${quotedText}\n\n${currentPrompt}`;
      logger.debug(`📝 Combined text prompt: ${combinedPrompt.substring(0, 100)}...`);
      return {
        hasImage: false,
        hasVideo: false,
        hasAudio: false,
        prompt: combinedPrompt,
        imageUrl: null,
        videoUrl: null,
        audioUrl: null
      };
    }

    // For media messages (image/video/audio/sticker), try to get downloadUrl
    if (quotedType === 'imageMessage' || quotedType === 'videoMessage' || quotedType === 'audioMessage' || quotedType === 'stickerMessage') {
      logger.debug(`📸 Quoted ${quotedType}, attempting to extract media URL...`);

      const { extractQuotedMediaUrls } = await import('../../services/whatsapp/mediaExtraction');
      const mediaUrls = await extractQuotedMediaUrls(quotedMessage, chatId);

      const downloadUrl = mediaUrls.imageUrl || mediaUrls.videoUrl || mediaUrls.audioUrl;

      // STEP 4: If still no downloadUrl, throw error
      if (!downloadUrl || downloadUrl === '') {
        logger.warn(`❌ No downloadUrl or thumbnail found for quoted ${quotedType} (stanzaId: ${quotedMessage.stanzaId})`);
        throw new Error(`לא הצלחתי לגשת ל${quotedType === 'imageMessage' ? 'תמונה' : quotedType === 'videoMessage' ? 'וידאו' : 'מדיה'} המצוטטת. ייתכן שהיא נמחקה או ממספר אחר.`);
      }

      logger.debug(`✅ Successfully extracted downloadUrl for quoted ${quotedType}`);

      // Extract caption from media message (if exists)
      // Caption can be directly on quotedMessage or nested in fileMessageData/imageMessageData
      let originalCaption = null;
      if (quotedType === 'imageMessage' || quotedType === 'stickerMessage') {
        originalCaption = quotedMessage.caption || quotedMessage.fileMessageData?.caption || quotedMessage.imageMessageData?.caption;
      } else if (quotedType === 'videoMessage') {
        originalCaption = quotedMessage.caption || quotedMessage.fileMessageData?.caption || quotedMessage.videoMessageData?.caption;
      }

      let finalPrompt = currentPrompt;

      logger.debug(`📝 [handleQuotedMessage] Original caption found: "${originalCaption}"`);
      logger.debug(`📝 [handleQuotedMessage] Current prompt (additional): "${currentPrompt}"`);

      // Check if there's a caption with a command (starts with #)
      // If so, we should treat the caption as the prompt for the media
      if (originalCaption && isCommand(originalCaption)) {
        logger.debug(`📝 Caption has command format, extracting prompt`);
        const cleanCaption = extractCommandPrompt(originalCaption);
        if (cleanCaption) {
          finalPrompt = `${cleanCaption} ${finalPrompt}`.trim();
          logger.debug(`📝 Merged caption into prompt: ${finalPrompt}`);
        }
      } else if (originalCaption) {
        // If there's a caption but it's not a command, append it to the current prompt
        // This handles cases where the user provides additional context with the media
        if (currentPrompt && currentPrompt.trim()) {
          finalPrompt = `${originalCaption}, ${currentPrompt}`;
          logger.debug(`🔗 Merged caption with additional instructions: "${finalPrompt.substring(0, 100)}..."`);
        } else {
          finalPrompt = originalCaption;
        }
      }

      // Return the URL directly - let the handler functions download when needed
      return {
        hasImage: quotedType === 'imageMessage' || quotedType === 'stickerMessage',
        hasVideo: quotedType === 'videoMessage',
        hasAudio: quotedType === 'audioMessage',
        prompt: finalPrompt, // Use merged prompt (original caption + additional instructions)
        imageUrl: (quotedType === 'imageMessage' || quotedType === 'stickerMessage') ? downloadUrl : null,
        videoUrl: quotedType === 'videoMessage' ? downloadUrl : null,
        audioUrl: quotedType === 'audioMessage' ? downloadUrl : null
      };
    }

    // For other types, just use current prompt
    logger.debug(`⚠️ Unsupported quoted message type: ${quotedType}, using current prompt only`);
    return {
      hasImage: false,
      hasVideo: false,
      hasAudio: false,
      prompt: currentPrompt,
      imageUrl: null,
      videoUrl: null,
      audioUrl: null
    };

  } catch (error: any) {
    logger.error('❌ Error handling quoted message:', { error: error.message });

    // If it's a downloadUrl error for bot's own messages, return a clear error
    if (error.message.includes('Cannot process media from bot')) {
      return {
        hasImage: false,
        hasVideo: false,
        hasAudio: false,
        prompt: currentPrompt,
        imageUrl: null,
        videoUrl: null,
        audioUrl: null,
        error: '⚠️ לא יכול לעבד תמונות/וידאו/אודיו שהבוט שלח. שלח את המדיה מחדש או צטט הודעה ממשתמש אחר.'
      };
    }

    // If it's our custom error message (inaccessible media), return it to user
    if (error.message.includes('לא הצלחתי לגשת ל')) {
      return {
        hasImage: false,
        hasVideo: false,
        hasAudio: false,
        prompt: currentPrompt,
        imageUrl: null,
        videoUrl: null,
        audioUrl: null,
        error: `⚠️ ${error.message}`
      };
    }

    // For other errors, fallback to current prompt only (don't show error to user)
    return {
      hasImage: false,
      hasVideo: false,
      hasAudio: false,
      prompt: currentPrompt,
      imageUrl: null,
      videoUrl: null,
      audioUrl: null
    };
  }
}
