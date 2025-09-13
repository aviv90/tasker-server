const express = require('express');
const router = express.Router();
const { sendTextMessage, sendFileByUrl, downloadFile } = require('../services/greenApiService');
const { generateTextResponse: generateOpenAIResponse, generateImageForWhatsApp: generateOpenAIImage, editImageForWhatsApp: editOpenAIImage } = require('../services/openaiService');
const { generateTextResponse: generateGeminiResponse, generateImageForWhatsApp, editImageForWhatsApp, generateVideoForWhatsApp } = require('../services/geminiService');
const conversationManager = require('../services/conversationManager');

// Message deduplication cache - prevent processing duplicate messages
const processedMessages = new Set();

// Clean up old processed messages every 30 minutes
setInterval(() => {
  if (processedMessages.size > 1000) {
    processedMessages.clear();
    console.log('🧹 Cleared processed messages cache');
  }
}, 30 * 60 * 1000);

/**
 * Send immediate acknowledgment for long-running commands
 */
async function sendAck(chatId, command) {
  let ackMessage = '';
  
  switch (command.type) {
    case 'gemini_image':
      ackMessage = '🎨 קיבלתי. מיד יוצר תמונה';
      break;
    case 'openai_image':
      ackMessage = '🖼️ קיבלתי. מיד יוצר תמונה';
      break;
    case 'veo3_video':
      ackMessage = '🎬 קיבלתי. מיד יוצר וידאו עם Veo 3';
      break;
    case 'voice_generation':
      ackMessage = '🎤 קיבלתי. מיד יוצר קול';
      break;
    default:
      return; // No ACK needed for this command
  }
  
  try {
    await sendTextMessage(chatId, ackMessage);
    console.log(`✅ ACK sent for ${command.type}`);
  } catch (error) {
    console.error('❌ Error sending ACK:', error.message || error);
  }
}

/**
 * WhatsApp Green API Integration Routes
 * 
 * 🚨 BACKWARD COMPATIBILITY RULE:
 * Any new WhatsApp functionality MUST maintain backward compatibility
 * with Tasker Android polling system (/api/start-task + /api/task-status).
 */

/**
 * Webhook endpoint for receiving WhatsApp messages from Green API
 */
router.post('/webhook', async (req, res) => {
  try {
    // Security check: Verify webhook token
    const token = req.headers['authorization']?.replace('Bearer ', '') ||
                  req.query.token || 
                  req.body.token;
    
    const expectedToken = process.env.GREEN_API_WEBHOOK_TOKEN;
    
    if (!expectedToken) {
      console.error('❌ GREEN_API_WEBHOOK_TOKEN not configured in environment');
      return res.status(500).json({ error: 'Webhook token not configured' });
    }
    
    if (token !== expectedToken) {
      console.error('❌ Unauthorized webhook request - invalid token');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const webhookData = req.body;
    console.log('📱 Green API webhook received:', JSON.stringify(webhookData, null, 2));

    // Handle different webhook types asynchronously
    if (webhookData.typeWebhook === 'incomingMessageReceived') {
      // Process in background - don't await
      handleIncomingMessage(webhookData).catch(error => {
        console.error('❌ Error in async webhook processing:', error.message || error);
      });
    }

    // Return 200 OK immediately
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('❌ Error processing webhook:', error.message || error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Handle incoming WhatsApp message
 */
async function handleIncomingMessage(webhookData) {
  try {
    const messageData = webhookData.messageData;
    const senderData = webhookData.senderData;
    
    // Extract message ID for deduplication
    const messageId = webhookData.idMessage;
    
    // Check if we already processed this message
    if (processedMessages.has(messageId)) {
      console.log(`🔄 Duplicate message detected, skipping: ${messageId}`);
      return;
    }
    
    // Mark message as processed
    processedMessages.add(messageId);
    
    const chatId = senderData.chatId;
    const senderId = senderData.sender;
    const senderName = senderData.senderName || senderId;
    
    console.log(`📱 Message from: ${senderName} (${chatId})`);
    console.log(`📋 Message type: ${messageData.typeMessage}`);
    console.log(`🆔 Message ID: ${messageId}`);
    
    // Handle text messages (both regular and extended)
    let messageText = null;
    
    if (messageData.typeMessage === 'textMessage') {
      messageText = messageData.textMessageData?.textMessage;
      console.log(`📝 Regular text message: "${messageText}"`);
    } else if (messageData.typeMessage === 'extendedTextMessage') {
      messageText = messageData.extendedTextMessageData?.text;
      console.log(`📝 Extended text message: "${messageText}"`);
    }
    
    // Handle image messages for image-to-image editing
    if (messageData.typeMessage === 'imageMessage') {
      const imageData = messageData.fileMessageData || messageData.imageMessageData;
      const caption = imageData?.caption || '';
      
      console.log(`🖼️ Image message received with caption: "${caption}"`);
      
      // Check if caption starts with "*" for Gemini image editing
      if (caption.startsWith('* ')) {
        const prompt = caption.substring(2).trim(); // Remove "* "
        console.log(`🎨 Gemini image edit request with prompt: "${prompt}"`);
        
        // Process Gemini image editing asynchronously
        processImageEditAsync({
          chatId,
          senderId,
          senderName,
          imageUrl: imageData.downloadUrl,
          prompt: prompt,
          service: 'gemini'
        });
      } 
      // Check if caption starts with "#" for OpenAI image editing
      else if (caption.startsWith('# ')) {
        const prompt = caption.substring(2).trim(); // Remove "# "
        console.log(`🖼️ OpenAI image edit request with prompt: "${prompt}"`);
        
        // Process OpenAI image editing asynchronously
        processImageEditAsync({
          chatId,
          senderId,
          senderName,
          imageUrl: imageData.downloadUrl,
          prompt: prompt,
          service: 'openai'
        });
      } else {
        console.log(`ℹ️ Image received but no edit command (caption should start with "* " for Gemini or "# " for OpenAI)`);
      }
    } else if (messageText) {
      // Process text message asynchronously - don't await
      processTextMessageAsync({
        chatId,
        senderId,
        senderName,
        messageText: messageText.trim()
      });
    } else {
      console.log(`ℹ️ Unsupported message type: ${messageData.typeMessage}`);
    }
  } catch (error) {
    console.error('❌ Error handling incoming message:', error.message || error);
  }
}

/**
 * Process text message asynchronously (no await from webhook)
 */
function processTextMessageAsync(messageData) {
  // Run in background without blocking webhook response
  handleTextMessage(messageData).catch(error => {
    console.error('❌ Error in async message processing:', error.message || error);
  });
}

/**
 * Process image edit message asynchronously (no await from webhook)
 */
function processImageEditAsync(imageData) {
  // Run in background without blocking webhook response
  handleImageEdit(imageData).catch(error => {
    console.error('❌ Error in async image edit processing:', error.message || error);
  });
}

/**
 * Handle image edit with AI (Gemini or OpenAI)
 */
async function handleImageEdit({ chatId, senderId, senderName, imageUrl, prompt, service }) {
  console.log(`🎨 Processing ${service} image edit request from ${senderName}: "${prompt}"`);
  
  try {
    // Send immediate ACK
    const ackMessage = service === 'gemini' 
      ? '🎨 קיבלתי את התמונה. מיד עורך אותה עם Gemini...'
      : '🖼️ קיבלתי את התמונה. מיד עורך אותה עם OpenAI...';
    await sendTextMessage(chatId, ackMessage);
    
    // Add user message to conversation
    conversationManager.addMessage(chatId, 'user', `עריכת תמונה (${service}): ${prompt}`);
    
    // Download the image first
    console.log(`📥 Downloading image from URL (${imageUrl.length} chars)`);
    const imageBuffer = await downloadFile(imageUrl);
    const base64Image = imageBuffer.toString('base64');
    
    // Edit image with selected AI service
    let editResult;
    if (service === 'gemini') {
      editResult = await editImageForWhatsApp(prompt, base64Image);
    } else if (service === 'openai') {
      editResult = await editOpenAIImage(prompt, base64Image);
    }
    
    if (editResult.success && editResult.imageUrl) {
      // Send the edited image with caption
      const fileName = `${service}_edit_${Date.now()}.png`;
      const caption = editResult.description && editResult.description.length > 0 
        ? editResult.description 
        : '';
      
      await sendFileByUrl(chatId, editResult.imageUrl, fileName, caption);
      
      // Add AI response to conversation history
      if (caption) {
        conversationManager.addMessage(chatId, 'assistant', caption);
      }
      
      console.log(`✅ ${service} edited image sent to ${senderName}${caption ? ' with caption: ' + caption : ''}`);
    } else {
      const errorMsg = editResult.error || 'לא הצלחתי לערוך את התמונה. נסה שוב מאוחר יותר.';
      await sendTextMessage(chatId, `❌ סליחה, ${errorMsg}`);
      console.log(`❌ ${service} image edit failed for ${senderName}: ${errorMsg}`);
    }
  } catch (error) {
    console.error(`❌ Error in ${service} image editing:`, error.message || error);
    await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה בעריכת התמונה.');
  }
}

/**
 * Handle text message with AI chat functionality
 */
async function handleTextMessage({ chatId, senderId, senderName, messageText }) {
  console.log(`💬 Processing text: "${messageText}"`);
  
  const command = parseTextCommand(messageText);
  
  if (!command) {
    console.log('ℹ️ Not a recognized command, ignoring');
    return;
  }

  console.log(`🤖 Executing command: ${command.type}`);

  // Send immediate ACK for long-running commands
  await sendAck(chatId, command);

  try {
    switch (command.type) {
      case 'gemini_chat':
        console.log(`🤖 Processing Gemini chat request from ${senderName}`);
        
        try {
          // Add user message to conversation
          conversationManager.addMessage(chatId, 'user', command.prompt);
          
          // Get conversation history for context
          const history = conversationManager.getHistory(chatId);
          
          // Generate Gemini response
          const geminiResponse = await generateGeminiResponse(command.prompt, history);
          
          if (geminiResponse.error) {
            await sendTextMessage(chatId, geminiResponse.error);
            console.log(`❌ Gemini error for ${senderName}: ${geminiResponse.error}`);
          } else {
            // Add AI response to conversation
            conversationManager.addMessage(chatId, 'assistant', geminiResponse.text);
            await sendTextMessage(chatId, geminiResponse.text);
          }
        } catch (geminiError) {
          console.error('❌ Error in Gemini chat:', geminiError.message || geminiError);
          await sendTextMessage(chatId, `❌ ${geminiError.message || geminiError}`);
        }
        break;

      case 'openai_chat':
        console.log(`🤖 Processing OpenAI chat request from ${senderName}`);
        
        try {
          // Add user message to conversation
          conversationManager.addMessage(chatId, 'user', command.prompt);
          
          // Get conversation history for context
          const openaiHistory = conversationManager.getHistory(chatId);
          
          // Generate OpenAI response
          const openaiResponse = await generateOpenAIResponse(command.prompt, openaiHistory);
          
          if (openaiResponse.error) {
            await sendTextMessage(chatId, openaiResponse.error);
            console.log(`❌ OpenAI error for ${senderName}: ${openaiResponse.error}`);
          } else {
            // Add AI response to conversation
            conversationManager.addMessage(chatId, 'assistant', openaiResponse.text);
            await sendTextMessage(chatId, openaiResponse.text);
          }
        } catch (openaiError) {
          console.error('❌ Error in OpenAI chat:', openaiError.message || openaiError);
          await sendTextMessage(chatId, `❌ ${openaiError.message || openaiError}`);
        }
        break;

      case 'openai_image':
        console.log(`🖼️ Processing OpenAI image generation request from ${senderName}`);
        
        try {
          // Add user message to conversation
          conversationManager.addMessage(chatId, 'user', `יצירת תמונה: ${command.prompt}`);
          
          // Generate image with OpenAI (WhatsApp format)
          const openaiImageResult = await generateOpenAIImage(command.prompt);
          
          if (openaiImageResult.success && openaiImageResult.imageUrl) {
            // Send the generated image with text as caption (if exists)
            const fileName = `openai_image_${Date.now()}.png`;
            const caption = openaiImageResult.description && openaiImageResult.description.length > 0 
              ? openaiImageResult.description 
              : '';
            
            await sendFileByUrl(chatId, openaiImageResult.imageUrl, fileName, caption);
            
            // Add AI response to conversation history
            if (caption) {
              conversationManager.addMessage(chatId, 'assistant', caption);
            }
            
            console.log(`✅ OpenAI image sent to ${senderName}${caption ? ' with caption: ' + caption : ''}`);
          } else {
            const errorMsg = openaiImageResult.error || 'לא הצלחתי ליצור תמונה. נסה שוב מאוחר יותר.';
            await sendTextMessage(chatId, `❌ סליחה, ${errorMsg}`);
            console.log(`❌ OpenAI image generation failed for ${senderName}: ${errorMsg}`);
          }
        } catch (openaiImageError) {
          console.error('❌ Error in OpenAI image generation:', openaiImageError.message || openaiImageError);
          await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה ביצירת התמונה.');
        }
        break;

      case 'gemini_image':
        console.log(`🎨 Processing Gemini image generation request from ${senderName}`);
        
        try {
          // Add user message to conversation
          conversationManager.addMessage(chatId, 'user', `יצירת תמונה: ${command.prompt}`);
          
          // Generate image with Gemini (WhatsApp format)
          const imageResult = await generateImageForWhatsApp(command.prompt);
          
          if (imageResult.success && imageResult.imageUrl) {
            // Send the generated image with text as caption
            const fileName = `gemini_image_${Date.now()}.png`;
            const caption = imageResult.description && imageResult.description.length > 0 
              ? imageResult.description 
              : '';
            
            await sendFileByUrl(chatId, imageResult.imageUrl, fileName, caption);
            
            // Add both user request and AI response to conversation history
            if (caption) {
              conversationManager.addMessage(chatId, 'assistant', caption);
            }
            
            console.log(`✅ Gemini image sent to ${senderName}${caption ? ' with caption: ' + caption : ''}`);
          } else {
            // Check if Gemini returned text instead of image
            if (imageResult.textResponse) {
              console.log('📝 Gemini returned text instead of image, sending text response');
              await sendTextMessage(chatId, imageResult.textResponse);
              
              // Add Gemini's text response to conversation history
              conversationManager.addMessage(chatId, 'assistant', imageResult.textResponse);
            } else {
              const errorMsg = imageResult.error || 'לא הצלחתי ליצור תמונה. נסה שוב מאוחר יותר.';
              await sendTextMessage(chatId, `❌ סליחה, ${errorMsg}`);
              console.log(`❌ Gemini image generation failed for ${senderName}: ${errorMsg}`);
            }
          }
        } catch (imageError) {
          console.error('❌ Error in Gemini image generation:', imageError.message || imageError);
          await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה ביצירת התמונה.');
        }
        break;

      case 'veo3_video':
        console.log(`🎬 Processing Veo 3 video generation request from ${senderName}`);
        
        try {
          // Add user message to conversation
          conversationManager.addMessage(chatId, 'user', `יצירת וידאו: ${command.prompt}`);
          
          // Generate video with Veo 3 (WhatsApp format)
          const videoResult = await generateVideoForWhatsApp(command.prompt);
          
          if (videoResult.success && videoResult.videoUrl) {
            // Send the generated video without caption
            const fileName = `veo3_video_${Date.now()}.mp4`;
            
            await sendFileByUrl(chatId, videoResult.videoUrl, fileName, '');
            
            // Add AI response to conversation history
            conversationManager.addMessage(chatId, 'assistant', `וידאו נוצר: ${videoResult.description || 'וידאו חדש'}`);
            
            console.log(`✅ Veo 3 video sent to ${senderName}`);
          } else {
            const errorMsg = videoResult.error || 'לא הצלחתי ליצור וידאו. נסה שוב מאוחר יותר.';
            await sendTextMessage(chatId, `❌ סליחה, ${errorMsg}`);
            console.log(`❌ Veo 3 video generation failed for ${senderName}: ${errorMsg}`);
          }
        } catch (videoError) {
          console.error('❌ Error in Veo 3 video generation:', videoError.message || videoError);
          await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה ביצירת הוידאו.');
        }
        break;

      case 'clear_conversation':
        const cleared = conversationManager.clearSession(chatId);
        if (cleared) {
          await sendTextMessage(chatId, '🗑️ היסטוריית השיחה נמחקה בהצלחה');
        } else {
          await sendTextMessage(chatId, 'ℹ️ אין היסטוריית שיחה למחיקה');
        }
        break;

      case 'show_history':
        const history = conversationManager.getHistory(chatId);
        if (history.length === 0) {
          await sendTextMessage(chatId, 'ℹ️ אין היסטוריית שיחה');
        } else {
          let historyText = '📋 היסטוריית השיחה:\n\n';
          history.forEach((msg, index) => {
            const role = msg.role === 'user' ? '👤 אתה' : '🤖 AI';
            historyText += `${index + 1}. ${role}: ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}\n\n`;
          });
          await sendTextMessage(chatId, historyText);
        }
        break;

      case 'help':
        const helpMessage = '🤖 Green API Bot Commands:\n\n💬 AI Chat:\n🔮 * [שאלה] - Gemini Chat\n🤖 # [שאלה] - OpenAI Chat\n\n🎨 יצירת תמונות:\n🖼️ ** [תיאור] - יצירת תמונה עם Gemini\n🖼️ ## [תיאור] - יצירת תמונה עם OpenAI\n\n🎬 יצירת וידאו:\n🎥 #### [תיאור] - יצירת וידאו עם Veo 3 (9:16, איכות מקסימלית)\n\n✨ עריכת תמונות:\n🎨 שלח תמונה עם כותרת: * [הוראות עריכה] - Gemini\n🖼️ שלח תמונה עם כותרת: # [הוראות עריכה] - OpenAI\n\n⚙️ ניהול שיחה:\n🗑️ /clear - מחיקת היסטוריה\n📝 /history - הצגת היסטוריה\n❓ /help - הצגת עזרה זו\n\n💡 דוגמאות:\n* מה ההבדל בין AI לבין ML?\n# כתוב לי שיר על חתול\n** חתול כתום שיושב על עץ\n## דרקון אדום עף בשמיים\n#### שפן אומר Hi\n🎨 תמונה + כותרת: * הוסף כובע אדום\n🖼️ תמונה + כותרת: # הפוך רקע לכחול';

        await sendTextMessage(chatId, helpMessage);
        break;

      default:
        console.log(`❓ Unknown command type: ${command.type}`);
    }
  } catch (error) {
    console.error('❌ Error executing command:', error.message || error);
    await sendTextMessage(chatId, `❌ ${error.message || error}`);
  }
}

/**
 * Parse text message to extract command
 */
function parseTextCommand(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  text = text.trim();

  // Veo 3 Video Generation command: #### + space + text
  if (text.startsWith('#### ')) {
    const prompt = text.substring(5).trim(); // Remove "#### "
    return {
      type: 'veo3_video',
      prompt: prompt,
      originalMessage: text
    };
  }

  // OpenAI Image Generation command: ## + space + text
  if (text.startsWith('## ')) {
    const prompt = text.substring(3).trim(); // Remove "## "
    return {
      type: 'openai_image',
      prompt: prompt,
      originalMessage: text
    };
  }

  // Gemini Image Generation command: ** + space + text
  if (text.startsWith('** ')) {
    const prompt = text.substring(3).trim(); // Remove "** "
    return {
      type: 'gemini_image',
      prompt: prompt,
      originalMessage: text
    };
  }

  // Gemini Chat command: * + space + text
  if (text.startsWith('* ')) {
    const prompt = text.substring(2).trim(); // Remove "* "
    return {
      type: 'gemini_chat',
      prompt: prompt,
      originalMessage: text
    };
  }

  // OpenAI Chat command: # + space + text
  if (text.startsWith('# ')) {
    const prompt = text.substring(2).trim(); // Remove "# "
    return {
      type: 'openai_chat',
      prompt: prompt,
      originalMessage: text
    };
  }

  // Clear conversation
  if (text.toLowerCase() === '/clear') {
    return { type: 'clear_conversation' };
  }

  // Show history
  if (text.toLowerCase() === '/history') {
    return { type: 'show_history' };
  }

  // Help
  if (text.toLowerCase() === '/help') {
    return { type: 'help' };
  }

  return null;
}

module.exports = router;
