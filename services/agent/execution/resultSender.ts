/**
 * Result sending utilities for agent execution
 * Handles sending various types of results to WhatsApp (location, poll, media, text)
 */

import { getServices } from '../utils/serviceLoader';
import { normalizeStaticFileUrl } from '../../../utils/urlUtils';
import { cleanJsonWrapper, cleanMediaDescription, cleanAmazonPrefix } from '../../../utils/textSanitizer';
import logger from '../../../utils/logger';
import { isIntermediateToolOutputInPipeline } from '../utils/pipelineDetection';

import { StepResult } from '../types';

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
        stepResult.latitude,
        stepResult.longitude,
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

      // If no caption but text exists, use text as caption
      if (!caption && stepResult.text && stepResult.text.trim()) {
        caption = cleanAmazonPrefix(stepResult.text);
      }

      const toolsWithUrls = new Set(['search_web', 'get_chat_history', 'chat_summary', 'translate_text', 'random_amazon_product', 'random_flight']);
      const hasToolWithUrls = stepResult.toolsUsed && stepResult.toolsUsed.some(tool => toolsWithUrls.has(tool));
      const cleanCaption = cleanMediaDescription(caption, hasToolWithUrls);

      // Send image WITH caption (caption is always sent with media, never separately)
      await greenApiService.sendFileByUrl(chatId, fullImageUrl, `agent_image_${Date.now()}.png`, cleanCaption, quotedMessageId || undefined, 1000);

      // Only send additional text in a separate message if:
      // 1. Text exists and is different from caption
      // 2. Text is not a generic success message or apology
      // 3. Text is meaningfully different (more than just whitespace/formatting)
      // (Additional text logic removed - delegated to sendText)

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

      // If no caption but text exists, use text as caption
      if (!caption && stepResult.text && stepResult.text.trim()) {
        caption = cleanAmazonPrefix(stepResult.text);
      }

      const toolsWithUrls = new Set(['search_web', 'get_chat_history', 'chat_summary', 'translate_text', 'random_amazon_product', 'random_flight']);
      const hasToolWithUrls = stepResult.toolsUsed && stepResult.toolsUsed.some(tool => toolsWithUrls.has(tool));
      const cleanCaption = cleanMediaDescription(caption, hasToolWithUrls);

      // Send video WITH caption (caption is always sent with media, never separately)
      await greenApiService.sendFileByUrl(chatId, fullVideoUrl, `agent_video_${Date.now()}.mp4`, cleanCaption, quotedMessageId || undefined, 1000);

      // (Additional text logic removed - delegated to sendText)

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
   * @param {string} [userText] - Optional: User's original text (for pipeline detection)
   */
  async sendText(chatId: string, stepResult: StepResult, stepNumber: number | null = null, quotedMessageId: string | null = null, userText: string | null = null): Promise<void> {
    if (!stepResult.text || !stepResult.text.trim()) {
      return;
    }

    // Pre-clean text for use in comparisons and sending
    // We do NOT use cleanAmazonPrefix here to avoid ad-hoc logic, but rely on robust comparison below
    let cleanText = stepResult.text.trim();

    // CRITICAL: Suppress intermediate tool output when it's part of a pipeline
    // Example: get_chat_history → create_image (user asked "צייר גרף שמתאר את היסטוריית השיחה")
    // In these cases, we should send only the final output, not the intermediate data
    if (userText) {
      const shouldSuppress = isIntermediateToolOutputInPipeline(stepResult, userText);
      if (shouldSuppress) {
        logger.debug(`⏭️ [ResultSender] Skipping text${stepNumber ? ` for step ${stepNumber}` : ''} - intermediate tool output in pipeline`);
        return;
      }
    }

    // Check if structured output was already sent
    const hasStructuredOutput = stepResult.latitude || stepResult.poll ||
      stepResult.imageUrl || stepResult.videoUrl ||
      stepResult.audioUrl || stepResult.locationInfo;

    // If structured output exists, check if text is just the caption/description (already sent)
    if (hasStructuredOutput) {
      const textToCheck = cleanMediaDescription(cleanText);

      // CRITICAL: For location - locationInfo is ALREADY sent by sendLocation
      // If text equals or contains locationInfo, skip sending it again
      if (stepResult.locationInfo && stepResult.locationInfo.trim()) {
        const locationInfoClean = cleanJsonWrapper(stepResult.locationInfo).trim();
        const textClean = cleanJsonWrapper(cleanText).trim();

        // Check if text is the same as locationInfo (or contains it)
        if (textClean === locationInfoClean ||
          textClean.includes(locationInfoClean) ||
          locationInfoClean.includes(textClean)) {
          logger.debug(`⏭️ [ResultSender] Skipping text${stepNumber ? ` for step ${stepNumber}` : ''} - same as locationInfo (already sent)`);
          return;
        }
      }

      if (stepResult.imageUrl) {
        // Determine the effective caption used by sendImage
        let effectiveCaption = stepResult.imageCaption || stepResult.caption || '';

        // If no explicit caption, sendImage uses text as caption (and cleans it!)
        if (!effectiveCaption) {
          effectiveCaption = cleanText;
        }

        const captionToCheck = cleanMediaDescription(effectiveCaption);

        // Case 1: Identical (Trimmed)
        if (textToCheck.trim() === captionToCheck.trim()) {
          logger.debug(`⏭️ [ResultSender] Skipping text${stepNumber ? ` for step ${stepNumber}` : ''} - identical to image caption`);
          return;
        }

        // Case 2: Text is Subset of Caption (Text < Caption)
        if (textToCheck.length < captionToCheck.length + 10 && captionToCheck.includes(textToCheck)) {
          logger.debug(`⏭️ [ResultSender] Skipping text - subset of image caption`);
          return;
        }

        // Case 3: Caption is Subset of Text (Text > Caption)
        // Example: Text="Sure, here is [Caption]", Caption="[Caption]"
        if (textToCheck.includes(captionToCheck)) {
          const residue = textToCheck.replace(captionToCheck, '').trim();
          // Allow up to 60 chars of filler/prefix/suffix tolerance
          if (residue.length < 60) {
            logger.debug(`⏭️ [ResultSender] Skipping text - superset of image caption (only filler diff)`);
            return;
          }
        }
      }
      // For videos: text is already sent separately in sendVideo
      else if (stepResult.videoUrl) {
        // Determine the effective caption used by sendVideo
        let effectiveCaption = stepResult.videoCaption || stepResult.caption || '';

        // If no explicit caption, sendVideo uses text as caption
        if (!effectiveCaption) {
          effectiveCaption = cleanText;
        }

        const captionToCheck = cleanMediaDescription(effectiveCaption); // Re-declared in separate block from image logic, so safe if scoped correctly. But here using one scope?
        // Ah, 'const' is block scoped. If 'else if' is separate block, it's fine. 
        // Note: The previous code had scope issues because I pasted into the middle of the function.
        // This replacement rewrites the whole function, so I can ensure proper scoping or use 'let'.
        // Better to use 'let' for variable that might be reused or distinct names.
        // Actually, inside 'else if' block, 'const' is fine.

        // Case 1: Identical (Trimmed)
        if (textToCheck.trim() === captionToCheck.trim()) {
          logger.debug(`⏭️ [ResultSender] Skipping text${stepNumber ? ` for step ${stepNumber}` : ''} - identical to video caption`);
          return;
        }

        // Case 2: Text is Subset of Caption (Text < Caption)
        if (textToCheck.length < captionToCheck.length + 10 && captionToCheck.includes(textToCheck)) {
          logger.debug(`⏭️ [ResultSender] Skipping text - subset of video caption`);
          return;
        }

        // Case 3: Caption is Subset of Text (Text > Caption)
        if (textToCheck.includes(captionToCheck)) {
          const residue = textToCheck.replace(captionToCheck, '').trim();
          if (residue.length < 60) {
            logger.debug(`⏭️ [ResultSender] Skipping text - superset of video caption (only filler diff)`);
            return;
          }
        }
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

      // Clean JSON wrappers first (before other cleaning)
      cleanText = cleanJsonWrapper(cleanText);

      // CRITICAL: For search_web and similar tools, URLs ARE the content - don't remove them!
      // Only remove URLs for creation tools where they might be duplicate artifacts
      const toolsWithUrls = new Set([
        'search_web',
        'get_chat_history',
        'chat_summary',
        'translate_text',
        'random_amazon_product',
        'random_flight'
      ]);
      const hasToolWithUrls = stepResult.toolsUsed && stepResult.toolsUsed.some(tool => toolsWithUrls.has(tool));

      if (!hasToolWithUrls) {
        // Remove URLs only if not a text-based tool that returns URLs as content
        cleanText = cleanText.replace(/https?:\/\/[^\s]+/gi, '').trim();
      } else {
        logger.debug(`🔗 [ResultSender] Preserving URLs in text for tool: ${stepResult.toolsUsed?.join(', ')}`);
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
   * @param {string} [userText] - Optional: User's original text (for pipeline detection)
   */
  async sendStepResults(chatId: string, stepResult: StepResult, stepNumber: number | null = null, quotedMessageId: string | null = null, userText: string | null = null): Promise<void> {
    await this.sendLocation(chatId, stepResult, stepNumber, quotedMessageId);
    await this.sendPoll(chatId, stepResult, stepNumber, quotedMessageId);
    await this.sendImage(chatId, stepResult, stepNumber, quotedMessageId);
    await this.sendVideo(chatId, stepResult, stepNumber, quotedMessageId);
    await this.sendAudio(chatId, stepResult, stepNumber, quotedMessageId);
    await this.sendText(chatId, stepResult, stepNumber, quotedMessageId, userText);
  }
}

export default new ResultSender();
