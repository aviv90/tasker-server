/**
 * Result sending utilities for agent execution
 * Handles sending various types of results to WhatsApp (location, poll, media, text)
 */

import { getServices } from '../utils/serviceLoader';
import { normalizeStaticFileUrl } from '../../../utils/urlUtils';
import { cleanJsonWrapper } from '../../../utils/textSanitizer';
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
      const caption = stepResult.imageCaption || stepResult.caption || '';

      await greenApiService.sendFileByUrl(chatId, fullImageUrl, `agent_image_${Date.now()}.png`, caption, quotedMessageId || undefined, 1000);

      logger.debug(`✅ [ResultSender] Image sent${stepInfo}`);
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

      await greenApiService.sendFileByUrl(chatId, fullVideoUrl, `agent_video_${Date.now()}.mp4`, '', quotedMessageId || undefined, 1000);

      logger.debug(`✅ [ResultSender] Video sent${stepInfo}`);
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
    // Check if structured output was already sent
    const hasStructuredOutput = stepResult.latitude || stepResult.poll ||
                                 stepResult.imageUrl || stepResult.videoUrl ||
                                 stepResult.audioUrl || stepResult.locationInfo;

    if (hasStructuredOutput || !stepResult.text || !stepResult.text.trim()) {
      if (hasStructuredOutput) {
        logger.debug(`⏭️ [ResultSender] Skipping text${stepNumber ? ` for step ${stepNumber}` : ''} - structured output already sent`);
      }
      return;
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
