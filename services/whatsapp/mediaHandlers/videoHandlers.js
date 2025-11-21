/**
 * Video Media Handlers
 * 
 * Handles video-to-video processing
 */

const { sendTextMessage, sendFileByUrl, downloadFile } = require('../../greenApiService');
const { generateRunwayVideoFromVideo } = require('../../geminiService');
const { sendAck } = require('../messaging');

/**
 * Handle video-to-video processing with RunwayML Gen4
 */
async function handleVideoToVideo({ chatId, senderId, senderName, videoUrl, prompt, originalMessageId }) {
  console.log(`🎬 Processing RunwayML Gen4 video-to-video request from ${senderName}`);

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

      await sendFileByUrl(chatId, videoResult.videoUrl, fileName, '', quotedMessageId, 1000);

      // Note: Video-to-video results do NOT add to conversation history

      console.log(`✅ RunwayML Gen4 video-to-video sent to ${senderName}`);
    } else {
      const errorMsg = videoResult.error || 'לא הצלחתי לעבד את הווידאו. נסה שוב מאוחר יותר.';
      await sendTextMessage(chatId, `❌ סליחה, ${errorMsg}`, quotedMessageId, 1000);
      console.log(`❌ RunwayML Gen4 video-to-video failed for ${senderName}: ${errorMsg}`);
    }
  } catch (error) {
    console.error('❌ Error in RunwayML Gen4 video-to-video:', error.message || error);
    await sendTextMessage(chatId, `❌ שגיאה בעיבוד הווידאו: ${error.message || error}`, quotedMessageId, 1000);
  }
}

module.exports = {
  handleVideoToVideo
};

