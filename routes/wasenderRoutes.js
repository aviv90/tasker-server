const express = require('express');
const router = express.Router();
const { sendTextMessage, sendFileByUrl, downloadFile } = require('../services/wasenderService');
const { generateTextResponse: generateGeminiResponse, editImageForWhatsApp } = require('../services/geminiService');
const { generateTextResponse: generateOpenAIResponse } = require('../services/openaiService');
const conversationManager = require('../services/conversationManager');

/**
 * WaSender API Integration Routes
 * 
 * Architecture:
 * 1. Tasker functions return: { text, imageBuffer } 
 * 2. WhatsApp functions return: { success, imageUrl, description }
 * 
 * Message Types:
 * - Text Message: simple text content
 * - Image Message: downloadUrl, caption, fileName
 * - Audio Message: downloadUrl, caption, fileName  
 * - Video Message: downloadUrl, caption, fileName
 * - Document Message: downloadUrl, caption, fileName
 * 
 * Commands:
 * - * [prompt] - Gemini chat response
 */

/**
 * WaSender Webhook endpoint 
 * Receives incoming WhatsApp messages and events
 */
router.post('/webhook', async (req, res) => {
  try {
    console.log('📨 WaSender webhook received:', JSON.stringify(req.body, null, 2));
    console.log('📋 WaSender webhook headers:', JSON.stringify(req.headers, null, 2));

    // Verify webhook secret for security
    const receivedSecret = req.headers['x-webhook-signature'];
    const expectedSecret = process.env.WASENDER_WEBHOOK_SECRET;
    
    if (!expectedSecret) {
      console.error('❌ WASENDER_WEBHOOK_SECRET not configured');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    // Verify signature (WaSender sends the secret directly in header)
    if (receivedSecret !== expectedSecret) {
      console.error('❌ Invalid webhook signature');
      console.log(`Expected: ${expectedSecret}`);
      console.log(`Received: ${receivedSecret}`);
      return res.status(403).json({ error: 'Invalid signature' });
    }
    
    const webhookData = req.body;
    
    // Handle different webhook event types based on WaSender format
    if (webhookData.event === 'messages.received' && webhookData.data && webhookData.data.messages) {
      await handleIncomingMessage(webhookData.data.messages, req);
    } else {
      console.log(`ℹ️ Unhandled webhook event: ${webhookData.event}`);
    }

    res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('❌ Error processing WaSender webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Handle incoming message from WaSender
 */
async function handleIncomingMessage(messageData, req) {
  try {
    console.log('📩 Processing WaSender incoming message:', JSON.stringify(messageData, null, 2));

    // Extract basic message info (adapt based on actual WaSender format)
    const chatId = messageData.key?.remoteJid;
    const senderId = messageData.key?.participant || chatId;
    const senderName = messageData.pushName || senderId;
    const messageId = messageData.key?.id;

    if (!chatId) {
      console.log('⚠️ No chat ID found in message');
      return;
    }

    console.log(`📱 Message from: ${senderName} (${chatId})`);

    // Handle different message types
    let messageText = null;
    
    if (messageData.message?.conversation) {
      // Simple text message
      messageText = messageData.message.conversation;
    } else if (messageData.message?.extendedTextMessage?.text) {
      // Extended text message (with formatting, replies, etc.)
      messageText = messageData.message.extendedTextMessage.text;
    }
    
    if (messageText) {
      // Handle text message only once
      await handleTextMessage({
        messageId,
        chatId,
        senderId,
        senderName,
        text: messageText,
        req
      });
    } else if (messageData.message?.imageMessage) {
      // Image message with potential caption
      await handleImageMessage({
        messageId,
        chatId,
        senderId,
        senderName,
        downloadUrl: messageData.message.imageMessage.url,
        caption: messageData.message.imageMessage.caption,
        fileName: messageData.message.imageMessage.fileName || 'image.jpg',
        req
      });
    } else {
      console.log(`ℹ️ Unsupported message type from ${senderName}`);
      console.log('Message structure:', JSON.stringify(messageData.message, null, 2));
    }
  } catch (error) {
    console.error('❌ Error handling incoming message:', error);
  }
}

/**
 * Handle text message - check for Gemini commands
 */
async function handleTextMessage({ messageId, chatId, senderId, senderName, text, req }) {
  try {
    console.log(`💬 Text message from ${senderName}: "${text}"`);

    // Parse command
    const command = parseTextCommand(text);
    
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
            await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה ביצירת התגובה.');
            console.log(`❌ Gemini error for ${senderName}: ${geminiResponse.error}`);
          } else {
            // Add AI response to conversation
            conversationManager.addMessage(chatId, 'assistant', geminiResponse.text);
            await sendTextMessage(chatId, geminiResponse.text);
          }
          
          console.log(`✅ Gemini response sent to ${senderName}`);
        } catch (geminiError) {
          console.error('❌ Error in Gemini chat:', geminiError);
          await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה בעיבוד הבקשה שלך.');
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
            await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה ביצירת התגובה.');
            console.log(`❌ OpenAI error for ${senderName}: ${openaiResponse.error}`);
          } else {
            // Add AI response to conversation
            conversationManager.addMessage(chatId, 'assistant', openaiResponse.text);
            await sendTextMessage(chatId, openaiResponse.text);
          }
          
          console.log(`✅ OpenAI response sent to ${senderName}`);
        } catch (openaiError) {
          console.error('❌ Error in OpenAI chat:', openaiError);
          await sendTextMessage(chatId, '❌ סליחה, הייתה שגיאה בעיבוד הבקשה שלך.');
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
        console.log(`📋 History shown to ${senderName}`);
        break;

      case 'help':
        const helpMessage = `🤖 **WaSender Bot Commands:**

💬 **AI Chat:**
🔮 \`* [שאלה]\` - Gemini Chat
🤖 \`# [שאלה]\` - OpenAI Chat (סולמית)

⚙️ **ניהול שיחה:**
🗑️ \`/clear\` - מחיקת היסטוריה
📝 \`/history\` - הצגת היסטוריה
❓ \`/help\` - הצגת עזרה זו

💡 **דוגמאות:**
\`* מה ההבדל בין AI לבין ML?\`
\`# כתוב לי שיר על חתול\``;

        await sendTextMessage(chatId, helpMessage);
        break;

      case 'unknown':
        // Message that doesn't start with * 
        console.log(`ℹ️ Regular message from ${senderName}, no action taken`);
        break;

      default:
        console.log(`⚠️ Unknown command type: ${command.type}`);
        break;
    }
  } catch (error) {
    console.error('❌ Error in handleTextMessage:', error);
    
    // Send useful error message to user
    try {
      await sendTextMessage(chatId, `❌ מצטער ${senderName}, קרתה שגיאה בעיבוד ההודעה שלך. נסה שוב מאוחר יותר.`);
    } catch (sendError) {
      console.error('❌ Failed to send error message:', sendError);
    }
  }
}

/**
 * Handle image message - check for editing commands
 */
async function handleImageMessage({ messageId, chatId, senderId, senderName, downloadUrl, caption, fileName, req }) {
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
        
        // Download the image from WaSender API
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
 * Parse text command and determine action
 * @param {string} text - The message text
 * @returns {Object} - Command object with type and prompt
 */
function parseTextCommand(text) {
  if (!text || typeof text !== 'string') {
    return { type: 'unknown', prompt: text, originalMessage: text };
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

  // OpenAI Chat command: # + space + text (like Green API)
  if (text.startsWith('# ')) {
    const prompt = text.substring(2).trim(); // Remove "# "
    return {
      type: 'openai_chat',
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

  if (text.toLowerCase() === '/history' || text.toLowerCase() === '/היסטוריה') {
    return {
      type: 'show_history', 
      prompt: text,
      originalMessage: text
    };
  }

  if (text.toLowerCase() === '/help' || text.toLowerCase() === '/עזרה') {
    return {
      type: 'help',
      prompt: text,
      originalMessage: text
    };
  }

  // Unknown command
  return {
    type: 'unknown',
    prompt: text,
    originalMessage: text
  };
}

module.exports = router;
