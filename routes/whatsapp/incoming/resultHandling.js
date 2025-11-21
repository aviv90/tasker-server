/**
 * Incoming Message Result Handling
 * 
 * Handles sending agent results (text, media, polls, locations) to WhatsApp
 */

const { sendTextMessage, sendFileByUrl, sendPoll, sendLocation } = require('../../../services/greenApiService');
const { getStaticFileUrl } = require('../../../utils/urlUtils');
const { cleanMediaDescription } = require('../../../utils/textSanitizer');
const { cleanAgentText } = require('../../../services/whatsapp/utils');
const conversationManager = require('../../../services/conversationManager');
const { executeAgentQuery } = require('../../../services/agentService');

/**
 * Send multi-step text response
 * @param {string} chatId - Chat ID
 * @param {string} text - Text to send
 * @param {string} [quotedMessageId] - Optional: ID of message to quote
 */
async function sendMultiStepText(chatId, text, quotedMessageId = null) {
  if (!text || !text.trim()) return;

  let cleanText = text
    .replace(/https?:\/\/[^\s]+/gi, '') // Remove URLs (image URLs should not be in text)
    .replace(/\[image\]/gi, '')
    .replace(/\[video\]/gi, '')
    .replace(/\[audio\]/gi, '')
    .replace(/\[תמונה\]/gi, '')
    .replace(/\[וידאו\]/gi, '')
    .replace(/\[אודיו\]/gi, '')
    .trim();

  if (cleanText) {
    await sendTextMessage(chatId, cleanText, quotedMessageId, 1000);
    console.log(`📤 [Multi-step] Text sent first (${cleanText.length} chars)`);
  } else {
    console.warn(`⚠️ [Multi-step] Text exists but cleanText is empty`);
  }
}

/**
 * Send image result
 * @param {string} chatId - Chat ID
 * @param {Object} agentResult - Agent result
 * @param {string} [quotedMessageId] - Optional: ID of message to quote
 * @returns {boolean} True if sent
 */
async function sendImageResult(chatId, agentResult, quotedMessageId = null) {
  if (!agentResult.imageUrl) return false;

  // For multi-step with alreadySent=true, image was already sent in agentService
  if (agentResult.multiStep && agentResult.alreadySent) {
    console.log(`✅ [Multi-step] Image already sent in agentService - skipping duplicate`);
    return false;
  }

  console.log(`📸 [Agent] Sending generated image: ${agentResult.imageUrl}`);

  let caption = '';

  // Multi-step: Use imageCaption if exists (LLM should return it in correct language)
  if (agentResult.multiStep) {
    caption = (agentResult.imageCaption && agentResult.imageCaption.trim()) || '';
    if (caption) {
      caption = cleanMediaDescription(caption);
      console.log(`📤 [Multi-step] Image sent with caption: "${caption.substring(0, 50)}..."`);
    } else {
      console.log(`📤 [Multi-step] Image sent after text (no caption)`);
    }
  } else {
    // Single-step: Images support captions - use them!
    const multipleTools = (agentResult.toolsUsed && agentResult.toolsUsed.length > 1);

    if (multipleTools) {
      // Multiple tools → use ONLY imageCaption (specific to this image)
      caption = agentResult.imageCaption || '';
      console.log(`ℹ️ Multiple tools detected - using imageCaption only to avoid mixing outputs`);
    } else {
      // Single tool → can use general text as fallback
      caption = agentResult.imageCaption || agentResult.text || '';
    }

    // Clean the caption: remove URLs, markdown links, code blocks, and technical markers
    caption = cleanMediaDescription(caption);
  }

  await sendFileByUrl(chatId, agentResult.imageUrl, `agent_image_${Date.now()}.png`, caption, quotedMessageId, 1000);
  return true;
}

/**
 * Send video result
 * @param {string} chatId - Chat ID
 * @param {Object} agentResult - Agent result
 * @param {string} [quotedMessageId] - Optional: ID of message to quote
 * @returns {boolean} True if sent
 */
async function sendVideoResult(chatId, agentResult, quotedMessageId = null) {
  if (!agentResult.videoUrl) return false;

  // For multi-step, video is already sent in agentService - skip here
  if (agentResult.multiStep && agentResult.alreadySent) {
    console.log(`⏭️ [Agent] Skipping video send - already sent in multi-step`);
    return false;
  }

  console.log(`🎬 [Agent] Sending generated video: ${agentResult.videoUrl}`);
  // Videos don't support captions well - send as file, text separately
  await sendFileByUrl(chatId, agentResult.videoUrl, `agent_video_${Date.now()}.mp4`, '', quotedMessageId, 1000);

  // If there's meaningful text (description/revised prompt), send it separately
  if (agentResult.text && agentResult.text.trim()) {
    const videoDescription = cleanMediaDescription(agentResult.text);
    if (videoDescription && videoDescription.length > 2) {
      await sendTextMessage(chatId, videoDescription, quotedMessageId, 1000);
    }
  }

  return true;
}

/**
 * Send audio result
 * @param {string} chatId - Chat ID
 * @param {Object} agentResult - Agent result
 * @param {string} [quotedMessageId] - Optional: ID of message to quote
 * @returns {boolean} True if sent
 */
async function sendAudioResult(chatId, agentResult, quotedMessageId = null) {
  if (!agentResult.audioUrl) return false;

  // For multi-step, audio is already sent in agentService - skip here
  if (agentResult.multiStep && agentResult.alreadySent) {
    console.log(`⏭️ [Agent] Skipping audio send - already sent in multi-step`);
    return false;
  }

  console.log(`🎵 [Agent] Sending generated audio: ${agentResult.audioUrl}`);
  // Audio doesn't support captions - send as file only
  const fullAudioUrl = agentResult.audioUrl.startsWith('http')
    ? agentResult.audioUrl
    : getStaticFileUrl(agentResult.audioUrl.replace('/static/', ''));
  await sendFileByUrl(chatId, fullAudioUrl, `agent_audio_${Date.now()}.mp3`, '', quotedMessageId, 1000);

  // For audio files (TTS/translate_and_speak), don't send text - the audio IS the response
  return true;
}

/**
 * Send poll result
 * @param {string} chatId - Chat ID
 * @param {Object} agentResult - Agent result
 * @param {string} [quotedMessageId] - Optional: ID of message to quote
 * @returns {boolean} True if sent
 */
async function sendPollResult(chatId, agentResult, quotedMessageId = null) {
  if (!agentResult.poll) return false;

  // For multi-step, poll is already sent in agentService - skip here
  if (agentResult.multiStep && agentResult.alreadySent) {
    console.log(`⏭️ [Agent] Skipping poll send - already sent in multi-step`);
    return false;
  }

  try {
    console.log(`📊 [Agent] Sending poll: ${agentResult.poll.question}`);
    // Convert options to Green API format
    const pollOptions = agentResult.poll.options.map(opt => ({ optionName: opt }));
    await sendPoll(chatId, agentResult.poll.question, pollOptions, false, quotedMessageId, 1000);
    return true;
  } catch (error) {
    console.error(`❌ [Agent] Failed to send poll:`, error.message);
    
    // Send error to user
    try {
      const { sendTextMessage } = require('../../services/greenApiService');
      const errorMsg = `❌ שגיאה בשליחת הסקר: ${error.message || 'שגיאה לא ידועה'}`;
      await sendTextMessage(chatId, errorMsg, quotedMessageId, 1000);
    } catch (sendError) {
      console.error(`❌ [Agent] Failed to send poll error message:`, sendError.message);
    }
    
    return false;
  }
}

/**
 * Send location result
 * @param {string} chatId - Chat ID
 * @param {Object} agentResult - Agent result
 * @param {string} [quotedMessageId] - Optional: ID of message to quote
 * @returns {boolean} True if sent
 */
async function sendLocationResult(chatId, agentResult, quotedMessageId = null) {
  if (!agentResult.latitude || !agentResult.longitude) return false;

  // For multi-step, location is already sent in agentService - skip here
  if (agentResult.multiStep && agentResult.alreadySent) {
    console.log(`⏭️ [Agent] Skipping location send - already sent in multi-step`);
    return false;
  }

  console.log(`📍 [Agent] Sending location: ${agentResult.latitude}, ${agentResult.longitude}`);
  await sendLocation(chatId, parseFloat(agentResult.latitude), parseFloat(agentResult.longitude), '', '', quotedMessageId, 1000);
  // Send location info as separate text message
  if (agentResult.locationInfo && agentResult.locationInfo.trim()) {
    await sendTextMessage(chatId, `📍 ${agentResult.locationInfo}`, quotedMessageId, 1000);
  }
  return true;
}

/**
 * Send single-step text result
 * @param {string} chatId - Chat ID
 * @param {Object} agentResult - Agent result
 * @param {boolean} mediaSent - Whether media was already sent
 * @param {string} [quotedMessageId] - Optional: ID of message to quote
 */
async function sendSingleStepText(chatId, agentResult, mediaSent, quotedMessageId = null) {
  // CRITICAL: If tool failed and error was already sent, don't send Gemini's error text
  // This prevents duplicate error messages (one from tool, one from Gemini final response)
  const hasToolError = agentResult.toolResults && 
                       Object.values(agentResult.toolResults).some(result => result?.error);
  
  if (hasToolError) {
    console.log(`⚠️ [Result Handling] Tool error detected - skipping Gemini final text to avoid duplicate`);
    return;
  }
  
  // Single-step: If no media was sent and it's not multi-step, send text response
  if (!agentResult.multiStep && !mediaSent && agentResult.text && agentResult.text.trim()) {
    const multipleTools = (agentResult.toolsUsed && agentResult.toolsUsed.length > 1);

    if (!multipleTools) {
      // Single tool → safe to send text
      const cleanText = cleanAgentText(agentResult.text);
      if (cleanText) {
        await sendTextMessage(chatId, cleanText, quotedMessageId, 1000);
      }
    } else {
      console.log(`ℹ️ Multiple tools detected - skipping general text to avoid mixing outputs`);
    }
  }
}

/**
 * Handle post-processing: generate complementary image if text+image requested
 * @param {string} chatId - Chat ID
 * @param {Object} normalized - Normalized input
 * @param {Object} agentResult - Agent result
 * @param {string} [quotedMessageId] - Optional: ID of message to quote
 */
async function handlePostProcessing(chatId, normalized, agentResult, quotedMessageId = null) {
  try {
    const userText = normalized.userText || '';

    // זיהוי בקשה לטקסט (ספר/כתוב/תאר/תגיד/אמור/describe/tell/write)
    const wantsText = /(ספר|תספר|כתוב|תכתוב|תכתבי|תכתבו|תאר|תארי|תארו|הסבר|תסביר|תסבירי|תגיד|תגידי|תאמר|תאמרי|ברכה|בדיחה|סיפור|טקסט|describe|tell|write|say|story|joke|text)/i.test(userText);

    // זיהוי בקשה לתמונה (תמונה/ציור/צייר/איור/image/picture/draw)
    const wantsImage = /(תמונה|תמונות|ציור|ציורית|צייר|ציירי|ציירו|תצייר|תציירי|תציירו|אייר|איירי|איירו|איור|איורים|image|images|picture|pictures|photo|photos|drawing|draw|illustration|art|poster|thumbnail)/i.test(userText);

    const imageAlreadyGenerated = !!agentResult.imageUrl;
    const hasTextResponse = agentResult.text && agentResult.text.trim().length > 0;

    if (wantsText && wantsImage && !imageAlreadyGenerated && hasTextResponse) {
      console.log('🎯 [Agent Post] Multi-step text+image request detected, but no image was generated. Creating image from text response...');

      // נבנה פרומפט לתמונה שמבוססת על הטקסט שהבוט כבר החזיר (למשל בדיחה)
      const baseText = agentResult.text.trim();
      const imagePrompt = `צור תמונה שממחישה בצורה ברורה ומצחיקה את הטקסט הבא (אל תכתוב טקסט בתמונה): """${baseText}"""`;

      // קריאה שנייה לאג'נט – הפעם בקשת תמונה פשוטה בלבד
      const imageResult = await executeAgentQuery(imagePrompt, chatId, {
        input: {
          ...normalized,
          userText: imagePrompt
        },
        lastCommand: null,
        maxIterations: 4
      });

      if (imageResult && imageResult.success && imageResult.imageUrl) {
        console.log(`📸 [Agent Post] Sending complementary image generated from text: ${imageResult.imageUrl}`);

        // Clean caption before sending
        let caption = (imageResult.imageCaption || '').trim();
        caption = cleanMediaDescription(caption);
        await sendFileByUrl(
          chatId,
          imageResult.imageUrl,
          `agent_image_${Date.now()}.png`,
          caption,
          quotedMessageId,
          1000
        );
      } else {
        console.warn('⚠️ [Agent Post] Failed to generate complementary image for text+image request');
      }
    }
  } catch (postError) {
    console.error('❌ [Agent Post] Error while handling text+image multi-step fallback:', postError.message);
  }
}

/**
 * Save bot response to conversation history
 * @param {string} chatId - Chat ID
 * @param {Object} agentResult - Agent result
 */
async function saveBotResponse(chatId, agentResult) {
  // CRITICAL: Save bot's response to conversation history for continuity!
  // This allows the bot to see its own previous responses in future requests
  if (agentResult.text && agentResult.text.trim()) {
    await conversationManager.addMessage(chatId, 'assistant', agentResult.text);
    console.log(`💾 [Agent] Saved bot response to conversation history`);
  }
}

/**
 * Send all agent results (text, media, polls, locations)
 * @param {string} chatId - Chat ID
 * @param {Object} agentResult - Agent result
 * @param {Object} normalized - Normalized input
 * @returns {Promise<boolean>} True if results were sent successfully
 */
async function sendAgentResults(chatId, agentResult, normalized) {
  // For multi-step, results are sent immediately after each step in agentService
  // If alreadySent is true, skip sending here to avoid duplicates
  if (agentResult.multiStep && agentResult.alreadySent) {
    console.log(`✅ [Multi-step] Results already sent immediately after each step - skipping duplicate sending`);
    console.log(`✅ [Agent] Completed successfully (${agentResult.iterations || 1} iterations, ${agentResult.toolsUsed?.length || 0} tools used)`);
    return true;
  }

  // Get quotedMessageId from agentResult or normalized
  const quotedMessageId = agentResult.originalMessageId || normalized?.originalMessageId || null;

  // Send any generated media (image/video/audio/poll) with captions
  let mediaSent = false;

  // Multi-step: Send text FIRST, then media
  if (agentResult.multiStep && agentResult.text && agentResult.text.trim()) {
    await sendMultiStepText(chatId, agentResult.text, quotedMessageId);
  } else {
    console.warn(`⚠️ [Multi-step] Text not sent - multiStep: ${agentResult.multiStep}, text: ${!!agentResult.text}, trimmed: ${!!agentResult.text?.trim()}`);
  }

  // CRITICAL: Send media if URLs exist (Rule: Media MUST be sent!)
  if (await sendImageResult(chatId, agentResult, quotedMessageId)) {
    mediaSent = true;
  }

  if (await sendVideoResult(chatId, agentResult, quotedMessageId)) {
    mediaSent = true;
  }

  if (await sendAudioResult(chatId, agentResult, quotedMessageId)) {
    mediaSent = true;
  }

  if (await sendPollResult(chatId, agentResult, quotedMessageId)) {
    mediaSent = true;
  }

  if (await sendLocationResult(chatId, agentResult, quotedMessageId)) {
    mediaSent = true;
  }

  // Single-step: If no media was sent, send text response
  await sendSingleStepText(chatId, agentResult, mediaSent, quotedMessageId);

  // Handle post-processing (complementary image generation)
  await handlePostProcessing(chatId, normalized, agentResult, quotedMessageId);

  // Save bot response to conversation history
  await saveBotResponse(chatId, agentResult);

  console.log(`✅ [Agent] Completed successfully (${agentResult.iterations || 1} iterations, ${agentResult.toolsUsed?.length || 0} tools used)`);
  return true;
}

module.exports = {
  sendAgentResults,
  sendMultiStepText,
  sendImageResult,
  sendVideoResult,
  sendAudioResult,
  sendPollResult,
  sendLocationResult,
  sendSingleStepText,
  handlePostProcessing,
  saveBotResponse
};

