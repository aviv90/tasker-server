/**
 * Quoted Message Handler
 * 
 * Handles processing of quoted/replied messages in WhatsApp.
 * Extracted from whatsappRoutes.js (Phase 4.6)
 */

import { getMessage } from '../../services/greenApiService';
import { getStaticFileUrl } from '../../utils/urlUtils';
import { saveBufferToTempFile } from '../../utils/tempFileUtils';
import { MessageData } from '../../services/whatsapp/types';
import logger from '../../utils/logger';

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
      
      let downloadUrl: string | null | undefined = null;
      
      // STEP 1: Try to get downloadUrl directly from quotedMessage (fastest path)
      if (quotedType === 'imageMessage' || quotedType === 'stickerMessage') {
        downloadUrl = quotedMessage.downloadUrl || 
                     quotedMessage.fileMessageData?.downloadUrl || 
                     quotedMessage.imageMessageData?.downloadUrl ||
                     quotedMessage.stickerMessageData?.downloadUrl;
      } else if (quotedType === 'videoMessage') {
        downloadUrl = quotedMessage.downloadUrl || 
                     quotedMessage.fileMessageData?.downloadUrl || 
                     quotedMessage.videoMessageData?.downloadUrl;
      } else if (quotedType === 'audioMessage') {
        downloadUrl = quotedMessage.downloadUrl || 
                     quotedMessage.fileMessageData?.downloadUrl || 
                     quotedMessage.audioMessageData?.downloadUrl;
      }
      
      // STEP 2: If downloadUrl is empty or not found, try getMessage API
      if (!downloadUrl || downloadUrl === '') {
        logger.debug(`📨 Fetching message ${quotedMessage.stanzaId} from chat ${chatId}`);
        try {
          interface GreenApiMessage {
            downloadUrl?: string;
            fileMessageData?: { downloadUrl?: string };
            imageMessageData?: { downloadUrl?: string };
            videoMessageData?: { downloadUrl?: string };
            audioMessageData?: { downloadUrl?: string };
            stickerMessageData?: { downloadUrl?: string };
            messageData?: {
              fileMessageData?: { downloadUrl?: string };
              imageMessageData?: { downloadUrl?: string };
              videoMessageData?: { downloadUrl?: string };
              audioMessageData?: { downloadUrl?: string };
              stickerMessageData?: { downloadUrl?: string };
            };
            [key: string]: unknown;
          }
          const originalMessage = await getMessage(chatId, quotedMessage.stanzaId!) as GreenApiMessage | null;
          
          if (originalMessage) {
            if (quotedType === 'imageMessage' || quotedType === 'stickerMessage') {
              downloadUrl = originalMessage.downloadUrl || 
                           originalMessage.fileMessageData?.downloadUrl || 
                           originalMessage.imageMessageData?.downloadUrl ||
                           originalMessage.stickerMessageData?.downloadUrl ||
                           originalMessage.messageData?.fileMessageData?.downloadUrl ||
                           originalMessage.messageData?.imageMessageData?.downloadUrl ||
                           originalMessage.messageData?.stickerMessageData?.downloadUrl ||
                           null;
            } else if (quotedType === 'videoMessage') {
              downloadUrl = originalMessage.downloadUrl || 
                           originalMessage.fileMessageData?.downloadUrl || 
                           originalMessage.videoMessageData?.downloadUrl ||
                           originalMessage.messageData?.fileMessageData?.downloadUrl ||
                           originalMessage.messageData?.videoMessageData?.downloadUrl ||
                           null;
            } else if (quotedType === 'audioMessage') {
              downloadUrl = originalMessage.downloadUrl || 
                           originalMessage.fileMessageData?.downloadUrl || 
                           originalMessage.audioMessageData?.downloadUrl ||
                           originalMessage.messageData?.fileMessageData?.downloadUrl ||
                           originalMessage.messageData?.audioMessageData?.downloadUrl ||
                           null;
            }
            
            if (downloadUrl) {
              logger.debug(`✅ Found downloadUrl via getMessage`);
            }
          }
        } catch (getMessageError: any) {
          logger.warn(`⚠️ getMessage failed: ${getMessageError.message}`);
          // Continue to STEP 3 - try thumbnail
        }
      }
      
      // STEP 3: If still no downloadUrl and there's a thumbnail, use it (for images only)
      if ((!downloadUrl || downloadUrl === '') && (quotedType === 'imageMessage' || quotedType === 'stickerMessage')) {
        const thumbnail = quotedMessage.jpegThumbnail as string | undefined; // || quotedMessage.thumbnail (not on MessageData)
        if (thumbnail) {
          logger.debug(`🖼️ No downloadUrl found, converting jpegThumbnail to temporary image...`);
          try {
            // Decode base64 thumbnail to buffer
            const thumbnailBuffer = Buffer.from(thumbnail, 'base64');
            // Save to temporary file in centralized temp directory
            const tempFileName = `quoted_image_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
            const { fileName } = saveBufferToTempFile(thumbnailBuffer, tempFileName);
            
            // Generate public URL
            downloadUrl = getStaticFileUrl(`/tmp/${fileName}`);
            logger.debug(`✅ Created temporary image from thumbnail: ${downloadUrl}`);
          } catch (thumbnailError: any) {
            logger.error(`❌ Failed to process thumbnail: ${thumbnailError.message}`);
          }
        }
      }
      
      // STEP 4: If still no downloadUrl, throw error
      if (!downloadUrl || downloadUrl === '') {
        logger.warn(`❌ No downloadUrl or thumbnail found for quoted ${quotedType}`);
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
      
      logger.debug(`📝 [handleQuotedMessage] Original caption found: "${originalCaption}"`);
      logger.debug(`📝 [handleQuotedMessage] Current prompt (additional): "${currentPrompt}"`);
      
      // If there's a caption with a command (starts with #), merge it with additional instructions
      let finalPrompt = currentPrompt;
      if (originalCaption && /^#\s+/.test(originalCaption.trim())) {
        // Remove # prefix from original caption
        const cleanCaption = originalCaption.trim().replace(/^#\s+/, '');
        // If there are additional instructions, append them
        if (currentPrompt && currentPrompt.trim()) {
          finalPrompt = `${cleanCaption}, ${currentPrompt}`;
          logger.debug(`🔗 Merged caption with additional instructions: "${finalPrompt.substring(0, 100)}..."`);
        } else {
          finalPrompt = cleanCaption;
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
