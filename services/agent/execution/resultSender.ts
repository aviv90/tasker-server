/**
 * Result sending utilities for agent execution
 * Handles sending various types of results to WhatsApp (location, poll, media, text)
 */

import { getServices } from '../utils/serviceLoader';
import { normalizeStaticFileUrl } from '../../../utils/urlUtils';
import { cleanJsonWrapper, cleanMediaDescription } from '../../../utils/textSanitizer';
import { cleanAgentText } from '../../../services/whatsapp/utils';
import logger from '../../../utils/logger';

interface PollOptions {
    options: string[];
    question: string;
    [key: string]: unknown;
}

interface StepResult {
    latitude?: string | null;
    longitude?: string | null;
    locationInfo?: string | null;
    poll?: PollOptions | null;
    imageUrl?: string | null;
    imageCaption?: string | null;
    caption?: string | null;
    videoUrl?: string | null;
    videoCaption?: string | null;
    audioUrl?: string | null;
    text?: string | null;
    toolsUsed?: string[];
    [key: string]: unknown;
}

class ResultSender {
  /**
   * Send location result to WhatsApp
   * @param {string} chatId - Chat ID
   * @param {Object} stepResult - Step result
   * @param {number} [stepNumber] - Step number
   * @param {string} [quotedMessageId] - Optional: ID of message to quote
   */
  async sendLocation(chatId: string, stepResult: StepResult, stepNumber: number | null = null, quotedMessageId: string | null = null): Promise<void> {
    if (!stepResult.latitude || !stepResult.longitude) return;

    try {
      const { greenApiService } = getServices();
      const stepInfo = stepNumber ? ` for step ${stepNumber}` : '';
      logger.debug(`📍 [ResultSender] Sending location${stepInfo}`);

      await greenApiService.sendLocation(
        chatId,
        parseFloat(stepResult.latitude),
        parseFloat(stepResult.longitude),
        '',
        '',
        quotedMessageId || undefined,
        1000
      );

      if (stepResult.locationInfo && stepResult.locationInfo.trim()) {
        // Clean JSON wrappers from locationInfo before sending
        const cleanLocationInfo = cleanJsonWrapper(stepResult.locationInfo);
        if (cleanLocationInfo) {
          await greenApiService.sendTextMessage(chatId, `📍 ${cleanLocationInfo}`, quotedMessageId || undefined, 1000);
        }
      }

      logger.debug(`✅ [ResultSender] Location sent${stepInfo}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ [ResultSender] Failed to send location${stepNumber ? ` for step ${stepNumber}` : ''}:`, { error: errorMessage });
    }
  }

  /**
   * Send poll result to WhatsApp
   * @param {string} chatId - Chat ID
   * @param {Object} stepResult - Step result
   * @param {number} [stepNumber] - Step number
   * @param {string} [quotedMessageId] - Optional: ID of message to quote
   */
  async sendPoll(chatId: string, stepResult: StepResult, stepNumber: number | null = null, quotedMessageId: string | null = null): Promise<void> {
    if (!stepResult.poll) return;

    try {
      const { greenApiService } = getServices();
      const stepInfo = stepNumber ? ` for step ${stepNumber}` : '';
      logger.debug(`📊 [ResultSender] Sending poll${stepInfo}`);

      const pollOptions = stepResult.poll.options;
      await greenApiService.sendPoll(chatId, stepResult.poll.question, pollOptions, false, quotedMessageId || undefined, 1000);

      logger.debug(`✅ [ResultSender] Poll sent${stepInfo}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ [ResultSender] Failed to send poll${stepNumber ? ` for step ${stepNumber}` : ''}:`, { error: errorMessage });
      
      // Send error to user
      try {
        const { greenApiService } = getServices();
        const errorMsg = `❌ שגיאה בשליחת הסקר: ${errorMessage || 'שגיאה לא ידועה'}`;
        await greenApiService.sendTextMessage(chatId, errorMsg, quotedMessageId || undefined, 1000);
      } catch (sendError: unknown) {
        const sendErrorMessage = sendError instanceof Error ? sendError.message : String(sendError);
        logger.error(`❌ [ResultSender] Failed to send poll error message:`, { error: sendErrorMessage });
      }
    }
  }

  /**
   * Send image result to WhatsApp
   * @param {string} chatId - Chat ID
   * @param {Object} stepResult - Step result
   * @param {number} [stepNumber] - Step number
   * @param {string} [quotedMessageId] - Optional: ID of message to quote
   */
  async sendImage(chatId: string, stepResult: StepResult, stepNumber: number | null = null, quotedMessageId: string | null = null): Promise<void> {
    if (!stepResult.imageUrl) return;

    try {
      const { greenApiService } = getServices();
      const stepInfo = stepNumber ? ` for step ${stepNumber}` : '';
      logger.debug(`🖼️ [ResultSender] Sending image${stepInfo}`);

      const fullImageUrl = normalizeStaticFileUrl(stepResult.imageUrl);
      
      // CRITICAL: Caption MUST be sent with the image, not in a separate message
      // Priority: imageCaption > caption > text (if text is not generic success message)
      let caption = stepResult.imageCaption || stepResult.caption || '';
      
      // If no caption but text exists and is not a generic success message, use text as caption
      if (!caption && stepResult.text && stepResult.text.trim()) {
        const textToCheck = cleanMediaDescription(stepResult.text);
        const genericSuccessPatterns = [
          /^✅\s*תמונה\s*נוצרה\s*בהצלחה/i,
          /^✅\s*תמונה\s*נוצרה/i,
          /^✅\s*נוצרה\s*בהצלחה/i,
          /^✅\s*image\s*created\s*successfully/i,
          /^✅\s*successfully\s*created/i
        ];
        const isGenericSuccess = genericSuccessPatterns.some(pattern => pattern.test(textToCheck.trim()));
        
        if (!isGenericSuccess) {
          caption = stepResult.text;
        }
      }
      
      const cleanCaption = cleanMediaDescription(caption);

      // Send image WITH caption (caption is always sent with media, never separately)
      await greenApiService.sendFileByUrl(chatId, fullImageUrl, `agent_image_${Date.now()}.png`, cleanCaption, quotedMessageId || undefined, 1000);

      // Only send additional text in a separate message if:
      // 1. Text exists and is different from caption
      // 2. Text is not a generic success message
      // 3. Text is meaningfully different (more than just whitespace/formatting)
      if (stepResult.text && stepResult.text.trim()) {
        const textToCheck = cleanMediaDescription(stepResult.text);
        const captionToCheck = cleanMediaDescription(caption);
        
        // Skip generic success messages - they're redundant when image is already sent
        const genericSuccessPatterns = [
          /^✅\s*תמונה\s*נוצרה\s*בהצלחה/i,
          /^✅\s*תמונה\s*נוצרה/i,
          /^✅\s*נוצרה\s*בהצלחה/i,
          /^✅\s*image\s*created\s*successfully/i,
          /^✅\s*successfully\s*created/i
        ];
        const isGenericSuccess = genericSuccessPatterns.some(pattern => pattern.test(textToCheck.trim()));
        
        if (isGenericSuccess) {
          logger.debug(`⏭️ [ResultSender] Skipping generic success message after image${stepInfo}`);
        }
        // Only send if text is meaningfully different from caption (more than just whitespace/formatting)
        else if (textToCheck.trim() !== captionToCheck.trim() && textToCheck.length > captionToCheck.length + 10) {
          const additionalText = cleanAgentText(stepResult.text);
          if (additionalText && additionalText.trim()) {
            logger.debug(`📝 [ResultSender] Sending additional text after image${stepInfo} (${additionalText.length} chars)`);
            await greenApiService.sendTextMessage(chatId, additionalText, quotedMessageId || undefined, 1000);
          }
        }
      }

      logger.debug(`✅ [ResultSender] Image sent${stepInfo} with caption: ${cleanCaption.substring(0, 50)}...`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ [ResultSender] Failed to send image${stepNumber ? ` for step ${stepNumber}` : ''}:`, { error: errorMessage });
    }
  }

  /**
   * Send video result to WhatsApp
   * @param {string} chatId - Chat ID
   * @param {Object} stepResult - Step result
   * @param {number} [stepNumber] - Step number
   * @param {string} [quotedMessageId] - Optional: ID of message to quote
   */
  async sendVideo(chatId: string, stepResult: StepResult, stepNumber: number | null = null, quotedMessageId: string | null = null): Promise<void> {
    if (!stepResult.videoUrl) return;

    try {
      const { greenApiService } = getServices();
      const stepInfo = stepNumber ? ` for step ${stepNumber}` : '';
      logger.debug(`🎬 [ResultSender] Sending video${stepInfo}`);

      const fullVideoUrl = normalizeStaticFileUrl(stepResult.videoUrl);

      // CRITICAL: Caption MUST be sent with the video, not in a separate message
      // Priority: videoCaption > caption > text (if text is not generic success message)
      let caption = stepResult.videoCaption || stepResult.caption || '';
      
      // If no caption but text exists and is not a generic success message, use text as caption
      if (!caption && stepResult.text && stepResult.text.trim()) {
        const textToCheck = cleanMediaDescription(stepResult.text);
        const genericSuccessPatterns = [
          /^✅\s*וידאו\s*נוצר\s*בהצלחה/i,
          /^✅\s*וידאו\s*נוצר/i,
          /^✅\s*video\s*created\s*successfully/i,
          /^✅\s*successfully\s*created/i
        ];
        const isGenericSuccess = genericSuccessPatterns.some(pattern => pattern.test(textToCheck.trim()));
        
        if (!isGenericSuccess) {
          caption = stepResult.text;
        }
      }
      
      const cleanCaption = cleanMediaDescription(caption);

      // Send video WITH caption (caption is always sent with media, never separately)
      await greenApiService.sendFileByUrl(chatId, fullVideoUrl, `agent_video_${Date.now()}.mp4`, cleanCaption, quotedMessageId || undefined, 1000);

      // Only send additional text in a separate message if:
      // 1. Text exists and is different from caption
      // 2. Text is not a generic success message
      // 3. Text is meaningfully different (more than just whitespace/formatting)
      if (stepResult.text && stepResult.text.trim()) {
        const textToCheck = cleanMediaDescription(stepResult.text);
        const captionToCheck = cleanMediaDescription(caption);
        
        // Skip generic success messages - they're redundant when video is already sent
        const genericSuccessPatterns = [
          /^✅\s*וידאו\s*נוצר\s*בהצלחה/i,
          /^✅\s*וידאו\s*נוצר/i,
          /^✅\s*video\s*created\s*successfully/i,
          /^✅\s*successfully\s*created/i
        ];
        const isGenericSuccess = genericSuccessPatterns.some(pattern => pattern.test(textToCheck.trim()));
        
        if (isGenericSuccess) {
          logger.debug(`⏭️ [ResultSender] Skipping generic success message after video${stepInfo}`);
        }
        // Only send if text is meaningfully different from caption
        else if (textToCheck.trim() !== captionToCheck.trim() && textToCheck.length > captionToCheck.length + 10) {
          const additionalText = cleanAgentText(stepResult.text);
          if (additionalText && additionalText.trim()) {
            logger.debug(`📝 [ResultSender] Sending additional text after video${stepInfo} (${additionalText.length} chars)`);
            await greenApiService.sendTextMessage(chatId, additionalText, quotedMessageId || undefined, 1000);
          }
        }
      }

      logger.debug(`✅ [ResultSender] Video sent${stepInfo} with caption: ${cleanCaption.substring(0, 50)}...`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ [ResultSender] Failed to send video${stepNumber ? ` for step ${stepNumber}` : ''}:`, { error: errorMessage });
    }
  }

  /**
   * Send audio result to WhatsApp
   * @param {string} chatId - Chat ID
   * @param {Object} stepResult - Step result
   * @param {number} [stepNumber] - Step number
   * @param {string} [quotedMessageId] - Optional: ID of message to quote
   */
  async sendAudio(chatId: string, stepResult: StepResult, stepNumber: number | null = null, quotedMessageId: string | null = null): Promise<void> {
    if (!stepResult.audioUrl) return;

    try {
      const { greenApiService } = getServices();
      const stepInfo = stepNumber ? ` for step ${stepNumber}` : '';
      logger.debug(`🎤 [ResultSender] Sending audio${stepInfo}`);

      const fullAudioUrl = normalizeStaticFileUrl(stepResult.audioUrl);

      await greenApiService.sendFileByUrl(chatId, fullAudioUrl, `agent_audio_${Date.now()}.mp3`, '', quotedMessageId || undefined, 1000);

      logger.debug(`✅ [ResultSender] Audio sent${stepInfo}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ [ResultSender] Failed to send audio${stepNumber ? ` for step ${stepNumber}` : ''}:`, { error: errorMessage });
    }
  }

  /**
   * Send text result to WhatsApp (only if no structured output was sent)
   * @param {string} chatId - Chat ID
   * @param {Object} stepResult - Step result
   * @param {number} [stepNumber] - Step number
   * @param {string} [quotedMessageId] - Optional: ID of message to quote
   */
  async sendText(chatId: string, stepResult: StepResult, stepNumber: number | null = null, quotedMessageId: string | null = null): Promise<void> {
    if (!stepResult.text || !stepResult.text.trim()) {
      return;
    }

    // Check if structured output was already sent
    const hasStructuredOutput = stepResult.latitude || stepResult.poll ||
                                 stepResult.imageUrl || stepResult.videoUrl ||
                                 stepResult.audioUrl || stepResult.locationInfo;

    // If structured output exists, check if text is just the caption/description (already sent)
    if (hasStructuredOutput) {
      const textToCheck = cleanMediaDescription(stepResult.text);
      const imageCaption = stepResult.imageCaption ? cleanMediaDescription(stepResult.imageCaption) : '';
      
      // For images: if text is same as caption, don't send again
      if (stepResult.imageUrl && textToCheck.trim() === imageCaption.trim()) {
        logger.debug(`⏭️ [ResultSender] Skipping text${stepNumber ? ` for step ${stepNumber}` : ''} - same as image caption`);
        return;
      }
      // For images: if text is just a generic success message (like "✅ תמונה נוצרה בהצלחה!"), don't send
      // The image with caption is already sent, no need for additional generic text
      if (stepResult.imageUrl) {
        const genericSuccessPatterns = [
          /^✅\s*תמונה\s*נוצרה\s*בהצלחה/i,
          /^✅\s*תמונה\s*נוצרה/i,
          /^✅\s*נוצרה\s*בהצלחה/i,
          /^✅\s*image\s*created\s*successfully/i,
          /^✅\s*successfully\s*created/i
        ];
        const isGenericSuccess = genericSuccessPatterns.some(pattern => pattern.test(textToCheck.trim()));
        if (isGenericSuccess) {
          logger.debug(`⏭️ [ResultSender] Skipping text${stepNumber ? ` for step ${stepNumber}` : ''} - generic success message, image already sent`);
          return;
        }
        // If sendImage already sent additional text (because it was different from caption), don't send again
        // sendImage sends text if it's meaningfully different from caption, so we should skip it here
        if (textToCheck.trim() !== imageCaption.trim() && textToCheck.length > imageCaption.length + 10) {
          logger.debug(`⏭️ [ResultSender] Skipping text${stepNumber ? ` for step ${stepNumber}` : ''} - already sent by sendImage`);
          return;
        }
      }
      // For videos: text is already sent separately in sendVideo
      else if (stepResult.videoUrl) {
        logger.debug(`⏭️ [ResultSender] Skipping text${stepNumber ? ` for step ${stepNumber}` : ''} - already sent with video`);
        return;
      }
      // For audio: audio IS the response, no additional text needed
      else if (stepResult.audioUrl) {
        logger.debug(`⏭️ [ResultSender] Skipping text${stepNumber ? ` for step ${stepNumber}` : ''} - audio is the response`);
        return;
      }
      // For other structured output: send text if it's meaningfully different
      else if (textToCheck.trim().length < 20) {
        logger.debug(`⏭️ [ResultSender] Skipping text${stepNumber ? ` for step ${stepNumber}` : ''} - too short to be meaningful`);
        return;
      }
      // Otherwise, send additional text even if structured output exists
      logger.debug(`📝 [ResultSender] Sending additional text${stepNumber ? ` for step ${stepNumber}` : ''} after structured output`);
    }

    try {
      const { greenApiService } = getServices();
      const stepInfo = stepNumber ? ` for step ${stepNumber}` : '';
      logger.debug(`📝 [ResultSender] Sending text${stepInfo}`);

      let cleanText = stepResult.text.trim();

      // Clean JSON wrappers first (before other cleaning)
      cleanText = cleanJsonWrapper(cleanText);

      // For search_web and similar tools, URLs are part of the content
      // Only remove URLs for creation tools where they might be duplicate artifacts
      const toolsWithUrls = ['search_web', 'get_chat_history', 'chat_summary', 'translate_text'];
      if (!stepResult.toolsUsed || !stepResult.toolsUsed.some(tool => toolsWithUrls.includes(tool))) {
        // Remove URLs only if not a text-based tool that returns URLs
        cleanText = cleanText.replace(/https?:\/\/[^\s]+/gi, '').trim();
      }

      if (cleanText) {
        await greenApiService.sendTextMessage(chatId, cleanText, quotedMessageId || undefined, 1000);
        logger.debug(`✅ [ResultSender] Text sent${stepInfo}`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ [ResultSender] Failed to send text${stepNumber ? ` for step ${stepNumber}` : ''}:`, { error: errorMessage });
    }
  }

  /**
   * Send all results from a step result in correct order
   * Order: location → poll → image → video → audio → text
   * @param {string} chatId - Chat ID
   * @param {Object} stepResult - Step result
   * @param {number} [stepNumber] - Step number
   * @param {string} [quotedMessageId] - Optional: ID of message to quote
   */
  async sendStepResults(chatId: string, stepResult: StepResult, stepNumber: number | null = null, quotedMessageId: string | null = null): Promise<void> {
    await this.sendLocation(chatId, stepResult, stepNumber, quotedMessageId);
    await this.sendPoll(chatId, stepResult, stepNumber, quotedMessageId);
    await this.sendImage(chatId, stepResult, stepNumber, quotedMessageId);
    await this.sendVideo(chatId, stepResult, stepNumber, quotedMessageId);
    await this.sendAudio(chatId, stepResult, stepNumber, quotedMessageId);
    await this.sendText(chatId, stepResult, stepNumber, quotedMessageId);
  }
}

export default new ResultSender();
