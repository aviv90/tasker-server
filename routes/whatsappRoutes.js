const express = require('express');
const router = express.Router();
const { sendTextMessage, sendFileByUrl, downloadFile } = require('../services/greenApiService');
const { generateTextResponse, generateImageForWhatsApp: generateOpenAIImageForWhatsApp } = require('../services/openaiService');
const { generateTextResponse: generateGeminiResponse, generateImageForWhatsApp, editImageForWhatsApp } = require('../services/geminiService');
const conversationManager = require('../services/conversationManager');

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

    // Handle different webhook types
    if (webhookData.typeWebhook === 'incomingMessageReceived') {
      await handleIncomingMessage(webhookData);
    }

    res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
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
    
    const chatId = senderData.chatId;
    const senderId = senderData.sender;
    const senderName = senderData.senderName || senderId;
    
    console.log(`📱 Message from: ${senderName} (${chatId})`);
    
    // Handle text messages
    if (messageData.typeMessage === 'textMessage') {
      const messageText = messageData.textMessageData?.textMessage;
      
      if (messageText) {
        await handleTextMessage({
          chatId,
          senderId,
          senderName,
          messageText: messageText.trim()
        });
      }
    }
  } catch (error) {
    console.error('❌ Error handling incoming message:', error);
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
          console.error('❌ Error in Gemini chat:', geminiError);
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
          console.error('❌ Error in OpenAI chat:', openaiError);
          await sendTextMessage(chatId, `❌ ${openaiError.message || openaiError}`);
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
          let historyText = '📋 **היסטוריית השיחה:**\n\n';
          history.forEach((msg, index) => {
            const role = msg.role === 'user' ? '👤 אתה' : '🤖 AI';
            historyText += `${index + 1}. ${role}: ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}\n\n`;
          });
          await sendTextMessage(chatId, historyText);
        }
        break;

      case 'help':
        const helpMessage = '🤖 Green API Bot Commands:\n\n💬 AI Chat:\n🔮 * [שאלה] - Gemini Chat\n🤖 # [שאלה] - OpenAI Chat\n\n⚙️ ניהול שיחה:\n🗑️ /clear - מחיקת היסטוריה\n📝 /history - הצגת היסטוריה\n❓ /help - הצגת עזרה זו\n\n💡 דוגמאות:\n* מה ההבדל בין AI לבין ML?\n# כתוב לי שיר על חתול';

        await sendTextMessage(chatId, helpMessage);
        break;

      default:
        console.log(`❓ Unknown command type: ${command.type}`);
    }
  } catch (error) {
    console.error('❌ Error executing command:', error);
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

/**
 * Webhook endpoint for receiving WhatsApp messages from Green API
 * 
 * Green API sends POST requests to this endpoint when:
 * - New message received
 * - File/media received
 * - Message status updates
 * 
 * Security: Requires GREEN_API_WEBHOOK_TOKEN in headers or query params
 * 
 * @route POST /api/whatsapp/webhook
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
    
    if (!token || token !== expectedToken) {
      console.error('❌ Invalid or missing webhook token');
      return res.status(401).json({ error: 'Unauthorized: Invalid webhook token' });
    }
    
    console.log('✅ Webhook token verified');
    console.log('📱 WhatsApp webhook received:', JSON.stringify(req.body, null, 2));
    
    const { typeWebhook, body } = req.body;
    
    // Handle different webhook types
    switch (typeWebhook) {
      case 'incomingMessageReceived':
        await handleIncomingMessage(req.body, req);
        break;
        
      case 'outgoingMessageStatus':
        await handleMessageStatus(req.body);
        break;
        
      case 'incomingCall':
        await handleIncomingCall(req.body);
        break;
        
      default:
        console.log(`ℹ️ Unhandled webhook type: ${typeWebhook}`);
    }
    
    // Always respond with 200 to acknowledge receipt
    res.status(200).json({ status: 'received' });
    
  } catch (error) {
    console.error('❌ Error processing WhatsApp webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get conversation statistics (for monitoring)
 * @route GET /api/whatsapp/stats
 */
router.get('/stats', (req, res) => {
  try {
    const stats = conversationManager.getStats();
    res.json({
      status: 'success',
      timestamp: new Date().toISOString(),
      stats: stats
    });
  } catch (error) {
    console.error('❌ Error getting conversation stats:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/**
 * Handle incoming WhatsApp message
 * @param {Object} webhookData - Full webhook data from Green API
 * @param {Object} req - Express request object for URL generation
 */
async function handleIncomingMessage(webhookData, req) {
  try {
    // Extract data from Green API webhook structure
    const {
      idMessage,
      timestamp,
      instanceData,
      senderData,
      messageData
    } = webhookData;

    const {
      chatId,
      sender: senderId,
      senderName,
      chatName
    } = senderData;

    const {
      typeMessage
    } = messageData;

    console.log(`📨 New ${typeMessage} message from ${senderName} (${senderId})`);
    console.log(`💬 Chat ID: ${chatId}`);
    console.log(`🏷️ Chat Name: ${chatName}`);
    
    switch (typeMessage) {
      case 'textMessage':
        const { textMessage } = messageData.textMessageData || {};
        await handleTextMessage({
          messageId: idMessage,
          chatId,
          senderId,
          senderName,
          text: textMessage,
          req
        });
        break;
        
      case 'audioMessage':
        const audioData = messageData.fileMessageData || {};
        await handleAudioMessage({
          messageId: idMessage,
          chatId,
          senderId,
          senderName,
          downloadUrl: audioData.downloadUrl,
          caption: audioData.caption,
          fileName: audioData.fileName
        });
        break;
        
      case 'imageMessage':
        const imageData = messageData.fileMessageData || {};
        await handleImageMessage({
          messageId: idMessage,
          chatId,
          senderId,
          senderName,
          downloadUrl: imageData.downloadUrl,
          caption: imageData.caption,
          fileName: imageData.fileName,
          thumbnail: imageData.jpegThumbnail,
          req
        });
        break;
        
      case 'videoMessage':
        const videoData = messageData.fileMessageData || {};
        await handleVideoMessage({
          messageId: idMessage,
          chatId,
          senderId,
          senderName,
          downloadUrl: videoData.downloadUrl,
          caption: videoData.caption,
          fileName: videoData.fileName,
          videoNote: videoData.videoNote  // Special field for instant video messages
        });
        break;
        
      case 'documentMessage':
        const docData = messageData.fileMessageData || {};
        await handleDocumentMessage({
          messageId: idMessage,
          chatId,
          senderId,
          senderName,
          downloadUrl: docData.downloadUrl,
          fileName: docData.fileName
        });
        break;
        
      case 'quotedMessage':
        // Handle quoted/reply messages
        const quotedData = messageData.extendedTextMessageData || {};
        const quotedMsg = messageData.quotedMessage || {};
        await handleQuotedMessage({
          messageId: idMessage,
          chatId,
          senderId,
          senderName,
          text: quotedData.text,
          quotedMessage: quotedMsg
        });
        break;
        
      default:
        console.log(`ℹ️ Unsupported message type: ${typeMessage}`);
    }
    
  } catch (error) {
    console.error('❌ Error handling incoming message:', error);
  }
}

/**
 * Parse user command from WhatsApp message
 * @param {string} message - The text message from user
 * @returns {object} - Parsed command object
 */
function parseCommand(message) {
  const text = message.trim();
  
  // OpenAI Chat command: # + space + text
  if (text.startsWith('# ')) {
    const prompt = text.substring(2).trim(); // Remove "# "
    return {
      type: 'openai_chat',
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
  
  // Gemini Image Generation command: ** + space + text
  if (text.startsWith('** ')) {
    const prompt = text.substring(3).trim(); // Remove "** "
    return {
      type: 'gemini_image',
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
  
  // Special commands for conversation management
  if (text.toLowerCase() === '/clear' || text.toLowerCase() === '/reset') {
    return {
      type: 'clear_conversation',
      prompt: text,
      originalMessage: text
    };
  }
  
  if (text.toLowerCase() === '/history' || text.toLowerCase() === '/context') {
    return {
      type: 'show_history',
      prompt: text,
      originalMessage: text
    };
  }
  
  if (text.toLowerCase() === '/help' || text.toLowerCase() === '/עזרה') {
    return {
      type: 'show_help',
      prompt: text,
      originalMessage: text
    };
  }
  
  // Later we'll add more commands like:
  // /image, /music, /video etc.
  
  return {
    type: 'unknown',
    prompt: text,
    originalMessage: text
  };
}

/**
 * Handle text message
 */
async function handleTextMessage({ messageId, chatId, senderId, senderName, text, req }) {
  console.log(`💬 Text message: "${text}"`);
  
  try {
    // Parse the command
    const command = parseCommand(text);
    console.log(`🎯 Parsed command:`, command);
    
    switch (command.type) {
      case 'openai_chat':
        console.log(`🤖 Processing OpenAI chat request from ${senderName}`);
        
        // Get conversation history
        const conversationHistory = conversationManager.getHistory(chatId);
        
        // Add user message to conversation
        conversationManager.addMessage(chatId, 'user', command.prompt);
        
        // Send to OpenAI with context
        const aiResponse = await generateTextResponse(command.prompt, conversationHistory);
        
        // Add AI response to conversation
        conversationManager.addMessage(chatId, 'assistant', aiResponse.text);
        
        // Send response back
        await sendTextMessage(chatId, aiResponse.text);
        
        console.log(`✅ OpenAI response sent to ${senderName}`);
        break;
        
      case 'gemini_chat':
        console.log(`🔮 Processing Gemini chat request from ${senderName}`);
        
        // Get conversation history
        const geminiConversationHistory = conversationManager.getHistory(chatId);
        
        // Add user message to conversation
        conversationManager.addMessage(chatId, 'user', command.prompt);
        
        // Send to Gemini with context
        const geminiResponse = await generateGeminiResponse(command.prompt, geminiConversationHistory);
        
        if (geminiResponse.error) {
          console.error('❌ Gemini generation failed:', geminiResponse.error);
          // Add error response to conversation
          conversationManager.addMessage(chatId, 'assistant', geminiResponse.text);
          await sendTextMessage(chatId, geminiResponse.text);
        } else {
          // Add AI response to conversation
          conversationManager.addMessage(chatId, 'assistant', geminiResponse.text);
          await sendTextMessage(chatId, geminiResponse.text);
        }
        
        console.log(`✅ Gemini response sent to ${senderName}`);
        break;
        
      case 'gemini_image':
        console.log(`🎨 Processing Gemini image generation request from ${senderName}`);
        
        try {
          // Add user message to conversation
          conversationManager.addMessage(chatId, 'user', command.prompt);
          
          // Generate image with Gemini (WhatsApp format)
          const imageResult = await generateImageForWhatsApp(command.prompt, req);
          
          if (imageResult.success && imageResult.imageUrl) {
            // Send Gemini's text response first (like "I will create an image of...")
            if (imageResult.description && imageResult.description.length > 0) {
              await sendTextMessage(chatId, imageResult.description);
              
              // Add Gemini's response to conversation history
              conversationManager.addMessage(chatId, 'assistant', imageResult.description);
            }
            
            // Send the generated image (without caption to avoid duplication)
            console.log(`🔗 Sending image: ${imageResult.imageUrl}`);
            console.log(`📄 File name: ${imageResult.fileName || "generated_image.png"}`);
            await sendFileByUrl(chatId, imageResult.imageUrl, "", imageResult.fileName || "generated_image.png");
            
            console.log(`✅ Gemini image sent to ${senderName}`);
          } else {
            await sendTextMessage(chatId, '❌ סליחה, לא הצלחתי ליצור תמונה. נסה שוב מאוחר יותר.');
            console.log(`❌ Gemini image generation failed for ${senderName}`);
          }
        } catch (imageError) {
          console.error('❌ Error in Gemini image generation:', imageError);
          await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה ביצירת התמונה.');
        }
        break;
        
      case 'openai_image':
        console.log(`🎨 Processing OpenAI image generation request from ${senderName}`);
        
        try {
          // Add user message to conversation
          conversationManager.addMessage(chatId, 'user', command.prompt);
          
          // Generate image with OpenAI (WhatsApp format)
          const imageResult = await generateOpenAIImageForWhatsApp(command.prompt, req);
          
          if (imageResult.success && imageResult.imageUrl) {
            // Send only the generated image (no text description)
            console.log(`🔗 Sending OpenAI image: ${imageResult.imageUrl}`);
            console.log(`📄 File name: ${imageResult.fileName || "openai_image.png"}`);
            await sendFileByUrl(chatId, imageResult.imageUrl, "", imageResult.fileName || "openai_image.png");
            
            console.log(`✅ OpenAI image sent to ${senderName}`);
          } else {
            await sendTextMessage(chatId, '❌ סליחה, לא הצלחתי ליצור תמונה עם OpenAI. נסה שוב מאוחר יותר.');
            console.log(`❌ OpenAI image generation failed for ${senderName}`);
          }
        } catch (imageError) {
          console.error('❌ Error in OpenAI image generation:', imageError);
          await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה ביצירת התמונה.');
        }
        break;
        
      case 'clear_conversation':
        const cleared = conversationManager.clearSession(chatId);
        if (cleared) {
          await sendTextMessage(chatId, "🗑️ היסטוריית השיחה נמחקה. התחלנו שיחה חדשה!");
          console.log(`🗑️ Conversation cleared for ${senderName}`);
        } else {
          await sendTextMessage(chatId, "ℹ️ אין היסטוריית שיחה לניקוי.");
        }
        break;
        
      case 'show_history':
        const hasSession = conversationManager.hasActiveSession(chatId);
        const history = conversationManager.getHistory(chatId);
        
        if (!hasSession || history.length === 0) {
          await sendTextMessage(chatId, "📝 אין היסטוריית שיחה נוכחית.");
        } else {
          const historyText = `📝 היסטוריית השיחה (${history.length} הודעות):\n\n` +
            history.map((msg, index) => 
              `${index + 1}. ${msg.role === 'user' ? '👤' : '🤖'} ${msg.content.substring(0, 50)}${msg.content.length > 50 ? '...' : ''}`
            ).join('\n');
          
          await sendTextMessage(chatId, historyText);
        }
        break;
        
      case 'show_help':
        const helpMessage = `שלום ${senderName}! 👋

🤖 **פקודות הבוט:**

💬 **צ'אט עם AI:**
🤖 \`# [שאלה]\` - OpenAI Chat
🔮 \`* [שאלה]\` - Gemini Chat

🎨 **יצירת תמונות:**
🖼️ \`** [תיאור]\` - יצירת תמונה עם Gemini
🎯 \`## [תיאור]\` - יצירת תמונה עם OpenAI
✏️ \`* [בקשה]\` - עריכת תמונה (שלח תמונה עם caption)

⚙️ **ניהול שיחה:**
🗑️ \`/clear\` - מחיקת היסטוריה
📝 \`/history\` - הצגת היסטוריה
❓ \`/help\` - הצגת עזרה זו

💡 **דוגמאות:**
\`# מה השעה בטוקיו?\`
\`* מה ההבדל בין AI לבין ML?\`
\`** חתול כתום שיושב על עץ\`
\`## כלב זהוב רץ בחוף הים\`
📸 שלח תמונה עם caption: \`* הוסף כובע אדום\``;

        await sendTextMessage(chatId, helpMessage);
        break;
        
      case 'unknown':
        // Message that doesn't start with # or *
        console.log(`ℹ️ Regular message from ${senderName}, no action taken`);
        
        // Send a brief help message for unknown commands
        await sendTextMessage(chatId, `שלום ${senderName}! 👋

לשליחת הודעה לבוט, התחל עם:
🤖 \`#\` לOpenAI | 🔮 \`*\` לGemini | 🎨 \`**\` לתמונה

שלח \`/help\` לעזרה מלאה`);
        break;
        
      default:
        console.log(`ℹ️ Unsupported command type: ${command.type}`);
    }
    
  } catch (error) {
    console.error('❌ Error handling text message:', error);
    
    // Send useful error message to user
    try {
      await sendTextMessage(chatId, `❌ מצטער ${senderName}, קרתה שגיאה בעיבוד ההודעה שלך. נסה שוב מאוחר יותר.`);
    } catch (sendError) {
      console.error('❌ Failed to send error message:', sendError);
    }
  }
}

/**
 * Handle audio/voice message
 */
async function handleAudioMessage({ messageId, chatId, senderId, senderName, downloadUrl, caption, fileName }) {
  console.log(`🎵 Audio message received: ${fileName || 'voice note'}`);
  console.log(`🔗 Download URL: ${downloadUrl}`);
  
  if (caption) {
    console.log(`📝 Caption: ${caption}`);
  }
  
  // TODO: Add your audio processing logic here
  // Examples:
  // - Download the audio file
  // - Process with your existing speech-to-text pipeline
  // - Create voice clone and respond with same voice
  
  try {
    // Example: Process audio through your existing pipeline
    // const audioBuffer = await downloadAudioFromUrl(downloadUrl);
    // const transcription = await speechService.speechToText(audioBuffer);
    // await sendWhatsAppMessage(chatId, {
    //   text: `I heard: "${transcription.text}"`
    // });
    
  } catch (error) {
    console.error('❌ Error processing audio message:', error);
  }
}

/**
 * Handle image message
 */
async function handleImageMessage({ messageId, chatId, senderId, senderName, downloadUrl, caption, fileName, thumbnail, req }) {
  console.log(`🖼️ Image message received: ${fileName || 'image'}`);
  console.log(`🔗 Download URL: ${downloadUrl}`);
  
  if (caption) {
    console.log(`📝 Caption: ${caption}`);
    
    // Check if caption starts with "* " for image editing
    if (caption.startsWith('* ')) {
      const editPrompt = caption.substring(2).trim(); // Remove "* "
      console.log(`🎨 Image editing request from ${senderName}: "${editPrompt}"`);
      
      try {
        // Add user message to conversation
        conversationManager.addMessage(chatId, 'user', `[Image Edit] ${editPrompt}`);
        
        // Download the image from Green API
        console.log('📥 Downloading image for editing...');
        const imageBuffer = await downloadFile(downloadUrl);
        
        // Convert to base64
        const base64Image = imageBuffer.toString('base64');
        
        // Edit image with Gemini
        const editResult = await editImageForWhatsApp(editPrompt, base64Image, req);
        
        if (editResult.success && editResult.imageUrl) {
          // Send the edited image
          console.log(`🔗 Sending edited image: ${editResult.imageUrl}`);
          console.log(`📄 File name: ${editResult.fileName || "edited_image.png"}`);
          await sendFileByUrl(chatId, editResult.imageUrl, "", editResult.fileName || "edited_image.png");
          
          console.log(`✅ Edited image sent to ${senderName}`);
        } else {
          await sendTextMessage(chatId, '❌ סליחה, לא הצלחתי לערוך את התמונה. נסה שוב מאוחר יותר.');
          console.log(`❌ Image editing failed for ${senderName}`);
        }
      } catch (editError) {
        console.error('❌ Error in image editing:', editError);
        await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה בעריכת התמונה.');
      }
      
      return; // Exit early for edit requests
    }
  }
  
  // Regular image message (no caption or non-edit caption)
  console.log(`ℹ️ Regular image message from ${senderName}, no action taken`);
}

/**
 * Handle video message
 */
async function handleVideoMessage({ messageId, chatId, senderId, senderName, downloadUrl, caption, fileName, videoNote }) {
  console.log(`🎥 Video message received: ${fileName || 'video'}`);
  
  if (videoNote) {
    console.log(`📱 This is an instant video message`);
  }
  
  console.log(`🔗 Download URL: ${downloadUrl}`);
  
  if (caption) {
    console.log(`📝 Caption: ${caption}`);
  }
  
  // TODO: Add your video processing logic here
}

/**
 * Handle document message
 */
async function handleDocumentMessage({ messageId, chatId, senderId, senderName, downloadUrl, fileName }) {
  console.log(`📄 Document received: ${fileName}`);
  console.log(`🔗 Download URL: ${downloadUrl}`);
  
  // TODO: Add your document processing logic here
}

/**
 * Handle quoted/reply message
 */
async function handleQuotedMessage({ messageId, chatId, senderId, senderName, text, quotedMessage }) {
  console.log(`💬 Reply message: "${text}"`);
  console.log(`🔄 Replying to ${quotedMessage.typeMessage} from ${quotedMessage.participant}`);
  
  // Log original message content based on type
  switch (quotedMessage.typeMessage) {
    case 'textMessage':
      console.log(`   Original text: "${quotedMessage.textMessage}"`);
      break;
    case 'imageMessage':
    case 'videoMessage':
    case 'documentMessage':
    case 'audioMessage':
      console.log(`   Original file: ${quotedMessage.caption || 'No caption'}`);
      break;
    default:
      console.log(`   Original message type: ${quotedMessage.typeMessage}`);
  }
  
  // TODO: Add your quoted message processing logic here
  // Examples:
  // - Context-aware responses based on quoted content
  // - Thread-like conversation handling
}

/**
 * Handle message status updates
 */
async function handleMessageStatus(webhookData) {
  // Green API status structure might be different, let's log it first
  console.log(`📊 Message status update:`, JSON.stringify(webhookData, null, 2));
  
  // TODO: Extract proper status data based on actual Green API format
  // const { idMessage, status, timestamp, chatId } = statusData;
  // console.log(`📊 Message ${idMessage} status: ${status}`);
}

/**
 * Handle incoming call notifications
 */
async function handleIncomingCall(webhookData) {
  console.log(`📞 Incoming call:`, JSON.stringify(webhookData, null, 2));
  
  // TODO: Handle incoming calls based on actual Green API format
}

/**
 * Utility function to send WhatsApp message (placeholder)
 * You'll need to implement this based on Green API's send message endpoint
 */
async function sendWhatsAppMessage(chatId, messageData) {
  // TODO: Implement Green API message sending
  // This would typically make a POST request to Green API's sendMessage endpoint
  console.log(`📤 Would send message to ${chatId}:`, messageData);
}

/**
 * Utility function to download file from URL (placeholder)
 */
async function downloadAudioFromUrl(url) {
  // TODO: Implement file download from Green API URL
  console.log(`📥 Would download audio from: ${url}`);
}

module.exports = router;
