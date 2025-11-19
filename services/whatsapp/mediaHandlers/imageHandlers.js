/**
 * Image Media Handlers
 * 
 * Handles image editing and image-to-video conversion
 */

const { sendTextMessage, sendFileByUrl, downloadFile } = require('../../greenApiService');
const conversationManager = require('../../conversationManager');
const {
  editImageForWhatsApp,
  editOpenAIImage,
  generateVideoFromImageForWhatsApp,
  generateVideoWithSoraFromImageForWhatsApp,
  generateKlingVideoFromImage
} = require('../../geminiService');

/**
 * Handle image editing with Gemini or OpenAI
 */
async function handleImageEdit({ chatId, senderId, senderName, imageUrl, prompt, service, originalMessageId }) {
  console.log(`🎨 Processing ${service} image edit request from ${senderName}`);

  // Get originalMessageId for quoting all responses
  const quotedMessageId = originalMessageId || null;

  try {
    // Send immediate ACK
    const ackMessage = service === 'gemini'
      ? '🎨 מעבד באמצעות Gemini...'
      : '🖼️ מעבד באמצעות OpenAI...';
    await sendTextMessage(chatId, ackMessage, quotedMessageId);

    // Note: Image editing commands do NOT add to conversation history

    if (!imageUrl) {
      throw new Error('No image URL provided');
    }

    // Download the image
    const imageBuffer = await downloadFile(imageUrl);

    const base64Image = imageBuffer.toString('base64');

    // Edit image with selected AI service
    let editResult;
    if (service === 'gemini') {
      editResult = await editImageForWhatsApp(prompt, base64Image);
    } else if (service === 'openai') {
      editResult = await editOpenAIImage(prompt, base64Image);
    }

    if (editResult.success) {
      let sentSomething = false;

      // Send text response if available
      if (editResult.description && editResult.description.trim()) {
        await sendTextMessage(chatId, editResult.description);

        // Note: Image editing results do NOT add to conversation history

        console.log(`✅ ${service} edit text response sent to ${senderName}: ${editResult.description}`);
        sentSomething = true;
      }

      // Send image if available (even if we already sent text)
      if (editResult.imageUrl) {
        const fileName = editResult.fileName || `${service}_edit_${Date.now()}.png`;

        await sendFileByUrl(chatId, editResult.imageUrl, fileName, '');

        console.log(`✅ ${service} edited image sent to ${senderName}`);
        sentSomething = true;
      }

      // If nothing was sent, it means we have success but no content
      if (!sentSomething) {
        await sendTextMessage(chatId, '✅ העיבוד הושלם בהצלחה', quotedMessageId);
        console.log(`✅ ${service} edit completed but no content to send to ${senderName}`);
      }
    } else {
      const errorMsg = editResult.error || 'לא הצלחתי לערוך את התמונה. נסה שוב מאוחר יותר.';
      await sendTextMessage(chatId, `❌ סליחה, ${errorMsg}`, quotedMessageId);
      console.log(`❌ ${service} image edit failed for ${senderName}: ${errorMsg}`);
    }
  } catch (error) {
    console.error(`❌ Error in ${service} image editing:`, error.message || error);
    await sendTextMessage(chatId, `❌ שגיאה בעריכת התמונה: ${error.message || error}`, quotedMessageId);
  }
}

/**
 * Handle image-to-video conversion with Veo 3, Sora 2, or Kling
 */
async function handleImageToVideo({ chatId, senderId, senderName, imageUrl, prompt, service = 'veo3', model = null, originalMessageId }) {
  let serviceName;
  if (service === 'veo3') {
    serviceName = 'Veo 3';
  } else if (service === 'sora') {
    serviceName = model === 'sora-2-pro' ? 'Sora 2 Pro' : 'Sora 2';
  } else {
    serviceName = 'Kling 2.1 Master';
  }
  console.log(`🎬 Processing ${serviceName} image-to-video request from ${senderName}`);

  // Get originalMessageId for quoting all responses
  const quotedMessageId = originalMessageId || null;

  try {
    // Send immediate ACK
    let ackMessage;
    if (service === 'veo3') {
      ackMessage = '🎬 יוצר וידאו עם Veo 3...';
    } else if (service === 'sora') {
      ackMessage = model === 'sora-2-pro'
        ? '🎬 יוצר וידאו עם Sora 2 Pro...'
        : '🎬 יוצר וידאו עם Sora 2...';
    } else {
      ackMessage = '🎬 יוצר וידאו עם Kling 2.1...';
    }
    await sendTextMessage(chatId, ackMessage, quotedMessageId);

    // Note: Image-to-video commands do NOT add to conversation history

    if (!imageUrl) {
      throw new Error('No image URL provided');
    }

    // Download the image
    const imageBuffer = await downloadFile(imageUrl);

    // Generate video with selected service
    let videoResult;
    if (service === 'veo3') {
      videoResult = await generateVideoFromImageForWhatsApp(prompt, imageBuffer);
    } else if (service === 'sora') {
      // Sora 2 image-to-video with image_reference
      const options = model ? { model } : {};
      videoResult = await generateVideoWithSoraFromImageForWhatsApp(prompt, imageBuffer, options);
    } else {
      videoResult = await generateKlingVideoFromImage(imageBuffer, prompt);
    }

    if (videoResult.success && videoResult.videoUrl) {
      // Send the generated video without caption
      const fileName = `${service}_image_video_${Date.now()}.mp4`;

      await sendFileByUrl(chatId, videoResult.videoUrl, fileName, '');

      // Add AI response to conversation history
      await conversationManager.addMessage(chatId, 'assistant', `וידאו נוצר מתמונה (${serviceName}): ${videoResult.description || 'וידאו חדש'}`);

      console.log(`✅ ${serviceName} image-to-video sent to ${senderName}`);
    } else {
      const errorMsg = videoResult.error || `לא הצלחתי ליצור וידאו מהתמונה עם ${serviceName}. נסה שוב מאוחר יותר.`;
      await sendTextMessage(chatId, `❌ סליחה, ${errorMsg}`, quotedMessageId);
      console.log(`❌ ${serviceName} image-to-video failed for ${senderName}: ${errorMsg}`);
    }
  } catch (error) {
    console.error(`❌ Error in ${serviceName} image-to-video:`, error.message || error);
    await sendTextMessage(chatId, `❌ שגיאה ביצירת הוידאו מהתמונה: ${error.message || error}`, quotedMessageId);
  }
}

module.exports = {
  handleImageEdit,
  handleImageToVideo
};

