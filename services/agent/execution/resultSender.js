const { getServices } = require('../utils/serviceLoader');
const { getStaticFileUrl } = require('../../../utils/urlUtils');
const { cleanJsonWrapper } = require('../../../utils/textSanitizer');

/**
 * Result sending utilities for agent execution
 * Handles sending various types of results to WhatsApp (location, poll, media, text)
 */
class ResultSender {
  /**
   * Send location result to WhatsApp
   * @param {string} chatId - Chat ID
   * @param {Object} stepResult - Step result
   * @param {number} [stepNumber] - Step number
   * @param {string} [quotedMessageId] - Optional: ID of message to quote
   */
  async sendLocation(chatId, stepResult, stepNumber = null, quotedMessageId = null) {
    if (!stepResult.latitude || !stepResult.longitude) return;

    try {
      const { greenApiService } = getServices();
      const stepInfo = stepNumber ? ` for step ${stepNumber}` : '';
      console.log(`📍 [ResultSender] Sending location${stepInfo}`);

      await greenApiService.sendLocation(
        chatId,
        parseFloat(stepResult.latitude),
        parseFloat(stepResult.longitude),
        '',
        '',
        quotedMessageId,
        1000
      );

      if (stepResult.locationInfo && stepResult.locationInfo.trim()) {
        // Clean JSON wrappers from locationInfo before sending
        const cleanLocationInfo = cleanJsonWrapper(stepResult.locationInfo);
        if (cleanLocationInfo) {
          await greenApiService.sendTextMessage(chatId, `📍 ${cleanLocationInfo}`, quotedMessageId, 1000);
        }
      }

      console.log(`✅ [ResultSender] Location sent${stepInfo}`);
    } catch (error) {
      console.error(`❌ [ResultSender] Failed to send location${stepNumber ? ` for step ${stepNumber}` : ''}:`, error.message);
    }
  }

  /**
   * Send poll result to WhatsApp
   * @param {string} chatId - Chat ID
   * @param {Object} stepResult - Step result
   * @param {number} [stepNumber] - Step number
   * @param {string} [quotedMessageId] - Optional: ID of message to quote
   */
  async sendPoll(chatId, stepResult, stepNumber = null, quotedMessageId = null) {
    if (!stepResult.poll) return;

    try {
      const { greenApiService } = getServices();
      const stepInfo = stepNumber ? ` for step ${stepNumber}` : '';
      console.log(`📊 [ResultSender] Sending poll${stepInfo}`);

      const pollOptions = stepResult.poll.options.map(opt => ({ optionName: opt }));
      await greenApiService.sendPoll(chatId, stepResult.poll.question, pollOptions, false, quotedMessageId, 1000);

      console.log(`✅ [ResultSender] Poll sent${stepInfo}`);
    } catch (error) {
      console.error(`❌ [ResultSender] Failed to send poll${stepNumber ? ` for step ${stepNumber}` : ''}:`, error.message);
      
      // Send error to user
      try {
        const { greenApiService } = getServices();
        const errorMsg = `❌ שגיאה בשליחת הסקר: ${error.message || 'שגיאה לא ידועה'}`;
        await greenApiService.sendTextMessage(chatId, errorMsg, quotedMessageId, 1000);
      } catch (sendError) {
        console.error(`❌ [ResultSender] Failed to send poll error message:`, sendError.message);
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
  async sendImage(chatId, stepResult, stepNumber = null, quotedMessageId = null) {
    if (!stepResult.imageUrl) return;

    try {
      const { greenApiService } = getServices();
      const stepInfo = stepNumber ? ` for step ${stepNumber}` : '';
      console.log(`🖼️ [ResultSender] Sending image${stepInfo}`);

      const fullImageUrl = stepResult.imageUrl.startsWith('http')
        ? stepResult.imageUrl
        : getStaticFileUrl(stepResult.imageUrl.replace('/static/', ''));
      const caption = stepResult.imageCaption || '';

      await greenApiService.sendFileByUrl(chatId, fullImageUrl, `agent_image_${Date.now()}.png`, caption, quotedMessageId, 1000);

      console.log(`✅ [ResultSender] Image sent${stepInfo}`);
    } catch (error) {
      console.error(`❌ [ResultSender] Failed to send image${stepNumber ? ` for step ${stepNumber}` : ''}:`, error.message);
    }
  }

  /**
   * Send video result to WhatsApp
   * @param {string} chatId - Chat ID
   * @param {Object} stepResult - Step result
   * @param {number} [stepNumber] - Step number
   * @param {string} [quotedMessageId] - Optional: ID of message to quote
   */
  async sendVideo(chatId, stepResult, stepNumber = null, quotedMessageId = null) {
    if (!stepResult.videoUrl) return;

    try {
      const { greenApiService } = getServices();
      const stepInfo = stepNumber ? ` for step ${stepNumber}` : '';
      console.log(`🎬 [ResultSender] Sending video${stepInfo}`);

      const fullVideoUrl = stepResult.videoUrl.startsWith('http')
        ? stepResult.videoUrl
        : getStaticFileUrl(stepResult.videoUrl.replace('/static/', ''));

      await greenApiService.sendFileByUrl(chatId, fullVideoUrl, `agent_video_${Date.now()}.mp4`, '', quotedMessageId, 1000);

      console.log(`✅ [ResultSender] Video sent${stepInfo}`);
    } catch (error) {
      console.error(`❌ [ResultSender] Failed to send video${stepNumber ? ` for step ${stepNumber}` : ''}:`, error.message);
    }
  }

  /**
   * Send audio result to WhatsApp
   * @param {string} chatId - Chat ID
   * @param {Object} stepResult - Step result
   * @param {number} [stepNumber] - Step number
   * @param {string} [quotedMessageId] - Optional: ID of message to quote
   */
  async sendAudio(chatId, stepResult, stepNumber = null, quotedMessageId = null) {
    if (!stepResult.audioUrl) return;

    try {
      const { greenApiService } = getServices();
      const stepInfo = stepNumber ? ` for step ${stepNumber}` : '';
      console.log(`🎤 [ResultSender] Sending audio${stepInfo}`);

      const fullAudioUrl = stepResult.audioUrl.startsWith('http')
        ? stepResult.audioUrl
        : getStaticFileUrl(stepResult.audioUrl.replace('/static/', ''));

      await greenApiService.sendFileByUrl(chatId, fullAudioUrl, `agent_audio_${Date.now()}.mp3`, '', quotedMessageId, 1000);

      console.log(`✅ [ResultSender] Audio sent${stepInfo}`);
    } catch (error) {
      console.error(`❌ [ResultSender] Failed to send audio${stepNumber ? ` for step ${stepNumber}` : ''}:`, error.message);
    }
  }

  /**
   * Send text result to WhatsApp (only if no structured output was sent)
   * @param {string} chatId - Chat ID
   * @param {Object} stepResult - Step result
   * @param {number} [stepNumber] - Step number
   * @param {string} [quotedMessageId] - Optional: ID of message to quote
   */
  async sendText(chatId, stepResult, stepNumber = null, quotedMessageId = null) {
    // Check if structured output was already sent
    const hasStructuredOutput = stepResult.latitude || stepResult.poll ||
                                 stepResult.imageUrl || stepResult.videoUrl ||
                                 stepResult.audioUrl || stepResult.locationInfo;

    if (hasStructuredOutput || !stepResult.text || !stepResult.text.trim()) {
      if (hasStructuredOutput) {
        console.log(`⏭️ [ResultSender] Skipping text${stepNumber ? ` for step ${stepNumber}` : ''} - structured output already sent`);
      }
      return;
    }

    try {
      const { greenApiService } = getServices();
      const stepInfo = stepNumber ? ` for step ${stepNumber}` : '';
      console.log(`📝 [ResultSender] Sending text${stepInfo}`);

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
        await greenApiService.sendTextMessage(chatId, cleanText, quotedMessageId, 1000);
        console.log(`✅ [ResultSender] Text sent${stepInfo}`);
      }
    } catch (error) {
      console.error(`❌ [ResultSender] Failed to send text${stepNumber ? ` for step ${stepNumber}` : ''}:`, error.message);
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
  async sendStepResults(chatId, stepResult, stepNumber = null, quotedMessageId = null) {
    await this.sendLocation(chatId, stepResult, stepNumber, quotedMessageId);
    await this.sendPoll(chatId, stepResult, stepNumber, quotedMessageId);
    await this.sendImage(chatId, stepResult, stepNumber, quotedMessageId);
    await this.sendVideo(chatId, stepResult, stepNumber, quotedMessageId);
    await this.sendAudio(chatId, stepResult, stepNumber, quotedMessageId);
    await this.sendText(chatId, stepResult, stepNumber, quotedMessageId);
  }
}

module.exports = new ResultSender();

