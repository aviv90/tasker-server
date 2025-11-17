const { getServices } = require('../utils/serviceLoader');
const { getStaticFileUrl } = require('../../../utils/urlUtils');

/**
 * Result sending utilities for agent execution
 * Handles sending various types of results to WhatsApp (location, poll, media, text)
 */
class ResultSender {
  /**
   * Send location result to WhatsApp
   */
  async sendLocation(chatId, stepResult, stepNumber = null) {
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
        ''
      );

      if (stepResult.locationInfo && stepResult.locationInfo.trim()) {
        await greenApiService.sendTextMessage(chatId, `📍 ${stepResult.locationInfo}`);
      }

      console.log(`✅ [ResultSender] Location sent${stepInfo}`);
    } catch (error) {
      console.error(`❌ [ResultSender] Failed to send location${stepNumber ? ` for step ${stepNumber}` : ''}:`, error.message);
    }
  }

  /**
   * Send poll result to WhatsApp
   */
  async sendPoll(chatId, stepResult, stepNumber = null) {
    if (!stepResult.poll) return;

    try {
      const { greenApiService } = getServices();
      const stepInfo = stepNumber ? ` for step ${stepNumber}` : '';
      console.log(`📊 [ResultSender] Sending poll${stepInfo}`);

      const pollOptions = stepResult.poll.options.map(opt => ({ optionName: opt }));
      await greenApiService.sendPoll(chatId, stepResult.poll.question, pollOptions, false);

      console.log(`✅ [ResultSender] Poll sent${stepInfo}`);
    } catch (error) {
      console.error(`❌ [ResultSender] Failed to send poll${stepNumber ? ` for step ${stepNumber}` : ''}:`, error.message);
    }
  }

  /**
   * Send image result to WhatsApp
   */
  async sendImage(chatId, stepResult, stepNumber = null) {
    if (!stepResult.imageUrl) return;

    try {
      const { greenApiService } = getServices();
      const stepInfo = stepNumber ? ` for step ${stepNumber}` : '';
      console.log(`🖼️ [ResultSender] Sending image${stepInfo}`);

      const fullImageUrl = stepResult.imageUrl.startsWith('http')
        ? stepResult.imageUrl
        : getStaticFileUrl(stepResult.imageUrl.replace('/static/', ''));
      const caption = stepResult.imageCaption || '';

      await greenApiService.sendFileByUrl(chatId, fullImageUrl, `agent_image_${Date.now()}.png`, caption);

      console.log(`✅ [ResultSender] Image sent${stepInfo}`);
    } catch (error) {
      console.error(`❌ [ResultSender] Failed to send image${stepNumber ? ` for step ${stepNumber}` : ''}:`, error.message);
    }
  }

  /**
   * Send video result to WhatsApp
   */
  async sendVideo(chatId, stepResult, stepNumber = null) {
    if (!stepResult.videoUrl) return;

    try {
      const { greenApiService } = getServices();
      const stepInfo = stepNumber ? ` for step ${stepNumber}` : '';
      console.log(`🎬 [ResultSender] Sending video${stepInfo}`);

      const fullVideoUrl = stepResult.videoUrl.startsWith('http')
        ? stepResult.videoUrl
        : getStaticFileUrl(stepResult.videoUrl.replace('/static/', ''));

      await greenApiService.sendFileByUrl(chatId, fullVideoUrl, `agent_video_${Date.now()}.mp4`, '');

      console.log(`✅ [ResultSender] Video sent${stepInfo}`);
    } catch (error) {
      console.error(`❌ [ResultSender] Failed to send video${stepNumber ? ` for step ${stepNumber}` : ''}:`, error.message);
    }
  }

  /**
   * Send audio result to WhatsApp
   */
  async sendAudio(chatId, stepResult, stepNumber = null) {
    if (!stepResult.audioUrl) return;

    try {
      const { greenApiService } = getServices();
      const stepInfo = stepNumber ? ` for step ${stepNumber}` : '';
      console.log(`🎤 [ResultSender] Sending audio${stepInfo}`);

      const fullAudioUrl = stepResult.audioUrl.startsWith('http')
        ? stepResult.audioUrl
        : getStaticFileUrl(stepResult.audioUrl.replace('/static/', ''));

      await greenApiService.sendFileByUrl(chatId, fullAudioUrl, `agent_audio_${Date.now()}.mp3`, '');

      console.log(`✅ [ResultSender] Audio sent${stepInfo}`);
    } catch (error) {
      console.error(`❌ [ResultSender] Failed to send audio${stepNumber ? ` for step ${stepNumber}` : ''}:`, error.message);
    }
  }

  /**
   * Send text result to WhatsApp (only if no structured output was sent)
   */
  async sendText(chatId, stepResult, stepNumber = null) {
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

      // For search_web and similar tools, URLs are part of the content
      // Only remove URLs for creation tools where they might be duplicate artifacts
      const toolsWithUrls = ['search_web', 'get_chat_history', 'chat_summary', 'translate_text'];
      if (!stepResult.toolsUsed || !stepResult.toolsUsed.some(tool => toolsWithUrls.includes(tool))) {
        // Remove URLs only if not a text-based tool that returns URLs
        cleanText = cleanText.replace(/https?:\/\/[^\s]+/gi, '').trim();
      }

      if (cleanText) {
        await greenApiService.sendTextMessage(chatId, cleanText);
        console.log(`✅ [ResultSender] Text sent${stepInfo}`);
      }
    } catch (error) {
      console.error(`❌ [ResultSender] Failed to send text${stepNumber ? ` for step ${stepNumber}` : ''}:`, error.message);
    }
  }

  /**
   * Send all results from a step result in correct order
   * Order: location → poll → image → video → audio → text
   */
  async sendStepResults(chatId, stepResult, stepNumber = null) {
    await this.sendLocation(chatId, stepResult, stepNumber);
    await this.sendPoll(chatId, stepResult, stepNumber);
    await this.sendImage(chatId, stepResult, stepNumber);
    await this.sendVideo(chatId, stepResult, stepNumber);
    await this.sendAudio(chatId, stepResult, stepNumber);
    await this.sendText(chatId, stepResult, stepNumber);
  }
}

module.exports = new ResultSender();

