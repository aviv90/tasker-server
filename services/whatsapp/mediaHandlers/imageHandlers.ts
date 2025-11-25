/**
 * Image Media Handlers
 * 
 * Handles image editing and image-to-video conversion
 */

import { sendTextMessage, sendFileByUrl, downloadFile } from '../../greenApiService';
import { formatProviderError } from '../../../utils/errorHandler';
import { TIME } from '../../../utils/constants';
import logger from '../../../utils/logger';
import {
  editImageForWhatsApp,
  generateVideoFromImageForWhatsApp as generateVeoVideo
} from '../../geminiService';
import { editImageForWhatsApp as editOpenAIImage } from '../../openai/image';
import { generateVideoWithSoraFromImageForWhatsApp } from '../../openai/video';
import { generateVideoFromImageForWhatsApp as generateKlingVideo } from '../../replicateService';

/**
 * Image edit handler parameters
 */
interface ImageEditParams {
  chatId: string;
  senderId?: string;
  senderName?: string;
  imageUrl: string;
  prompt: string;
  service: 'gemini' | 'openai';
  originalMessageId?: string;
}

/**
 * Image to video handler parameters
 */
interface ImageToVideoParams {
  chatId: string;
  senderId?: string;
  senderName?: string;
  imageUrl: string;
  prompt: string;
  service?: 'veo3' | 'sora' | 'kling';
  model?: string | null;
  originalMessageId?: string;
}

/**
 * Handle image editing with Gemini or OpenAI
 */
export async function handleImageEdit({ chatId, senderName, imageUrl, prompt, service, originalMessageId }: ImageEditParams): Promise<void> {
  logger.info(`🎨 Processing ${service} image edit request from ${senderName}`);

  // Get originalMessageId for quoting all responses
  const quotedMessageId = originalMessageId || null;

  try {
    // Send immediate ACK
    const ackMessage = service === 'gemini'
      ? '🎨 מעבד באמצעות Gemini...'
      : '🖼️ מעבד באמצעות OpenAI...';
    await sendTextMessage(chatId, ackMessage, quotedMessageId, TIME.TYPING_INDICATOR);

    // Note: Image editing commands do NOT add to conversation history

    if (!imageUrl) {
      throw new Error('No image URL provided');
    }

    // Download the image
    const imageBuffer = await downloadFile(imageUrl) as Buffer;

    const base64Image = imageBuffer.toString('base64');

    // Edit image with selected AI service
    let editResult: { success: boolean; description?: string; imageUrl?: string; fileName?: string; error?: string };
    if (service === 'gemini') {
      // Pass null for req as we are not in an express request context
      editResult = await editImageForWhatsApp(prompt, base64Image, null) as { success: boolean; description?: string; imageUrl?: string; fileName?: string; error?: string };
    } else if (service === 'openai') {
      editResult = await editOpenAIImage(prompt, base64Image, null) as { success: boolean; description?: string; imageUrl?: string; fileName?: string; error?: string };
    } else {
      throw new Error(`Unknown service: ${service}`);
    }

    if (editResult.success) {
      let sentSomething = false;

      // Send text response if available
      if (editResult.description && editResult.description.trim()) {
        await sendTextMessage(chatId, editResult.description, quotedMessageId, TIME.TYPING_INDICATOR);

        // Note: Image editing results do NOT add to conversation history

        logger.debug(`✅ ${service} edit text response sent to ${senderName}: ${editResult.description}`);
        sentSomething = true;
      }

      // Send image if available (even if we already sent text)
      if (editResult.imageUrl) {
        const fileName = editResult.fileName || `${service}_edit_${Date.now()}.png`;

        await sendFileByUrl(chatId, editResult.imageUrl, fileName, '', quotedMessageId, TIME.TYPING_INDICATOR);

        logger.debug(`✅ ${service} edited image sent to ${senderName}`);
        sentSomething = true;
      }

      // If nothing was sent, it means we have success but no content
      if (!sentSomething) {
        await sendTextMessage(chatId, '✅ העיבוד הושלם בהצלחה', quotedMessageId, TIME.TYPING_INDICATOR);
        logger.debug(`✅ ${service} edit completed but no content to send to ${senderName}`);
      }
    } else {
      const errorMsg = editResult.error || 'לא הצלחתי לערוך את התמונה. נסה שוב מאוחר יותר.';
      const formattedError = formatProviderError(service, errorMsg);
      await sendTextMessage(chatId, formattedError, quotedMessageId, TIME.TYPING_INDICATOR);
      logger.warn(`❌ ${service} image edit failed for ${senderName}: ${errorMsg}`);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`❌ Error in ${service} image editing:`, { error: errorMessage, stack: error instanceof Error ? error.stack : undefined });
    const formattedError = formatProviderError(service, errorMessage);
    await sendTextMessage(chatId, formattedError, quotedMessageId, TIME.TYPING_INDICATOR);
  }
}

/**
 * Handle image-to-video conversion with Veo 3, Sora 2, or Kling
 */
export async function handleImageToVideo({ chatId, senderName, imageUrl, prompt, service = 'veo3', model = null, originalMessageId }: ImageToVideoParams): Promise<void> {
  let serviceName: string;
  if (service === 'veo3') {
    serviceName = 'Veo 3';
  } else if (service === 'sora') {
    serviceName = model === 'sora-2-pro' ? 'Sora 2 Pro' : 'Sora 2';
  } else {
    serviceName = 'Kling 2.1 Master';
  }
  logger.info(`🎬 Processing ${serviceName} image-to-video request from ${senderName}`);

  // Get originalMessageId for quoting all responses
  const quotedMessageId = originalMessageId || null;

  try {
    // Send immediate ACK
    let ackMessage: string;
    if (service === 'veo3') {
      ackMessage = '🎬 יוצר וידאו עם Veo 3...';
    } else if (service === 'sora') {
      ackMessage = model === 'sora-2-pro'
        ? '🎬 יוצר וידאו עם Sora 2 Pro...'
        : '🎬 יוצר וידאו עם Sora 2...';
    } else {
      ackMessage = '🎬 יוצר וידאו עם Kling 2.1...';
    }
    await sendTextMessage(chatId, ackMessage, quotedMessageId, TIME.TYPING_INDICATOR);

    // Note: Image-to-video commands do NOT add to conversation history

    if (!imageUrl) {
      throw new Error('No image URL provided');
    }

    // Download the image
    const imageBuffer = await downloadFile(imageUrl) as Buffer;

    // Generate video with selected service
    let videoResult: { success: boolean; videoUrl?: string; error?: string };
    if (service === 'veo3') {
      videoResult = await generateVeoVideo(prompt, imageBuffer, null) as { success: boolean; videoUrl?: string; error?: string };
    } else if (service === 'sora') {
      // Sora 2 image-to-video with image_reference
      const options = model ? { model: model as 'sora-2' | 'sora-2-pro' } : {};
      videoResult = await generateVideoWithSoraFromImageForWhatsApp(prompt, imageBuffer, options) as { success: boolean; videoUrl?: string; error?: string };
    } else {
      // Kling (Replicate)
      videoResult = await generateKlingVideo(imageBuffer, prompt, null) as { success: boolean; videoUrl?: string; error?: string };
    }

    if (videoResult.success && videoResult.videoUrl) {
      // Send the generated video without caption
      const fileName = `${service}_image_video_${Date.now()}.mp4`;

      await sendFileByUrl(chatId, videoResult.videoUrl, fileName, '', quotedMessageId, TIME.TYPING_INDICATOR);

      // NOTE: Bot messages are no longer saved to DB to avoid duplication.
      // Bot messages are tracked in DB (message_types table) when sent through Green API.
      logger.debug(`💾 [ImageHandler] Video created (tracked in DB)`);

      logger.info(`✅ ${serviceName} image-to-video sent to ${senderName}`);
    } else {
      const errorMsg = videoResult.error || 'לא הצלחתי ליצור וידאו מהתמונה. נסה שוב מאוחר יותר.';
      // Map service to provider name for formatting
      const providerName = service === 'veo3' ? 'veo3' : service === 'sora' ? 'sora' : 'kling';
      const formattedError = formatProviderError(providerName, errorMsg);
      await sendTextMessage(chatId, formattedError, quotedMessageId, TIME.TYPING_INDICATOR);
      logger.warn(`❌ ${serviceName} image-to-video failed for ${senderName}: ${errorMsg}`);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`❌ Error in ${serviceName} image-to-video:`, { error: errorMessage, stack: error instanceof Error ? error.stack : undefined });
    // Map service to provider name for formatting
    const providerName = service === 'veo3' ? 'veo3' : service === 'sora' ? 'sora' : 'kling';
    const formattedError = formatProviderError(providerName, errorMessage);
    await sendTextMessage(chatId, formattedError, quotedMessageId, TIME.TYPING_INDICATOR);
  }
}
