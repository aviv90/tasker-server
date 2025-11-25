/**
 * Video Media Handlers
 * 
 * Handles video-to-video processing
 */

import { sendTextMessage, sendFileByUrl, downloadFile } from '../../greenApiService';
import { generateRunwayVideoFromVideo } from '../../geminiService';
import { sendAck } from '../messaging';
import { formatProviderError } from '../../../utils/errorHandler';
import { TIME } from '../../../utils/constants';
import logger from '../../../utils/logger';

/**
 * Video to video handler parameters
 */
interface VideoToVideoParams {
  chatId: string;
  senderId?: string;
  senderName?: string;
  videoUrl: string;
  prompt: string;
  originalMessageId?: string;
}

/**
 * Handle video-to-video processing with RunwayML Gen4
 */
export async function handleVideoToVideo({ chatId, senderName, videoUrl, prompt, originalMessageId }: VideoToVideoParams): Promise<void> {
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
    const videoBuffer = await downloadFile(videoUrl) as Buffer;

    // Generate video with RunwayML Gen4
    const videoResult = await generateRunwayVideoFromVideo(videoBuffer, prompt) as { success: boolean; videoUrl?: string; error?: string };

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
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Error in RunwayML Gen4 video-to-video:', { error: errorMessage, stack: error instanceof Error ? error.stack : undefined });
    const formattedError = formatProviderError('runway', errorMessage);
    await sendTextMessage(chatId, formattedError, quotedMessageId, TIME.TYPING_INDICATOR);
  }
}

