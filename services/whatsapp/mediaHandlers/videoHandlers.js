/**
 * Video Media Handlers
 * 
 * Handles video-to-video processing
 */

const { sendTextMessage, sendFileByUrl, downloadFile } = require('../../greenApiService');
const { generateRunwayVideoFromVideo } = require('../../geminiService');
const { sendAck } = require('../messaging');
const { formatProviderError } = require('../../../utils/errorHandler');
const { TIME } = require('../../../utils/constants');
const logger = require('../../../utils/logger');

/**
 * Handle video-to-video processing with RunwayML Gen4
 */
async function handleVideoToVideo({ chatId, senderId, senderName, videoUrl, prompt, originalMessageId }) {
  logger.info(`🎬 Processing RunwayML Gen4 video-to-video request from ${senderName}`);

  // Get originalMessageId for quoting all responses
  const quotedMessageId = originalMessageId || null;

  try {
    // Send immediate ACK
    await sendAck(chatId, { type: 'runway_video_to_video' });

    // Note: Video-to-video commands do NOT add to conversation history

    if (!videoUrl) {
      throw new Error('No video URL provided');
    }

    // Download the video
    const videoBuffer = await downloadFile(videoUrl);

    // Generate video with RunwayML Gen4
    const videoResult = await generateRunwayVideoFromVideo(videoBuffer, prompt);

    if (videoResult.success && videoResult.videoUrl) {
      // Send the generated video without caption
      const fileName = `runway_video_${Date.now()}.mp4`;

      await sendFileByUrl(chatId, videoResult.videoUrl, fileName, '', quotedMessageId, TIME.TYPING_INDICATOR);

      // Note: Video-to-video results do NOT add to conversation history

      logger.info(`✅ RunwayML Gen4 video-to-video sent to ${senderName}`);
    } else {
      const errorMsg = videoResult.error || 'לא הצלחתי לעבד את הווידאו. נסה שוב מאוחר יותר.';
      const formattedError = formatProviderError('runway', errorMsg);
      await sendTextMessage(chatId, formattedError, quotedMessageId, TIME.TYPING_INDICATOR);
      logger.warn(`❌ RunwayML Gen4 video-to-video failed for ${senderName}: ${errorMsg}`);
    }
  } catch (error) {
    logger.error('❌ Error in RunwayML Gen4 video-to-video:', { error: error.message || error, stack: error.stack });
    const formattedError = formatProviderError('runway', error.message || error);
    await sendTextMessage(chatId, formattedError, quotedMessageId, TIME.TYPING_INDICATOR);
  }
}

module.exports = {
  handleVideoToVideo
};

