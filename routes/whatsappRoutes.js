const express = require('express');
const router = express.Router();

/**
 * WhatsApp Green API Integration Routes
 * 
 * Handles incoming webhooks from Green API WhatsApp service
 * 
 * @version 1.0.0
 */

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
        await handleIncomingMessage(body);
        break;
        
      case 'outgoingMessageStatus':
        await handleMessageStatus(body);
        break;
        
      case 'incomingCall':
        await handleIncomingCall(body);
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
 * Handle incoming WhatsApp message
 * @param {Object} messageData - Message data from Green API
 */
async function handleIncomingMessage(messageData) {
  try {
    const {
      idMessage,
      timestamp,
      typeMessage,
      chatId,
      senderId,
      senderName,
      textMessage,
      downloadUrl,
      caption,
      fileName,
      jpegThumbnail
    } = messageData;

    console.log(`📨 New ${typeMessage} message from ${senderName} (${senderId})`);
    console.log(`💬 Chat ID: ${chatId}`);
    
    switch (typeMessage) {
      case 'textMessage':
        await handleTextMessage({
          messageId: idMessage,
          chatId,
          senderId,
          senderName,
          text: textMessage
        });
        break;
        
      case 'audioMessage':
        await handleAudioMessage({
          messageId: idMessage,
          chatId,
          senderId,
          senderName,
          downloadUrl,
          caption,
          fileName
        });
        break;
        
      case 'imageMessage':
        await handleImageMessage({
          messageId: idMessage,
          chatId,
          senderId,
          senderName,
          downloadUrl,
          caption,
          fileName,
          thumbnail: jpegThumbnail
        });
        break;
        
      case 'videoMessage':
        await handleVideoMessage({
          messageId: idMessage,
          chatId,
          senderId,
          senderName,
          downloadUrl,
          caption,
          fileName
        });
        break;
        
      case 'documentMessage':
        await handleDocumentMessage({
          messageId: idMessage,
          chatId,
          senderId,
          senderName,
          downloadUrl,
          fileName
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
 * Handle text message
 */
async function handleTextMessage({ messageId, chatId, senderId, senderName, text }) {
  console.log(`💬 Text message: "${text}"`);
  
  // TODO: Add your text message processing logic here
  // Examples:
  // - Bot commands
  // - AI responses
  // - Voice synthesis from text
  
  // Example: Auto-reply
  // await sendWhatsAppMessage(chatId, {
  //   text: `Hello ${senderName}! I received your message: "${text}"`
  // });
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
async function handleImageMessage({ messageId, chatId, senderId, senderName, downloadUrl, caption, fileName, thumbnail }) {
  console.log(`🖼️ Image message received: ${fileName || 'image'}`);
  console.log(`🔗 Download URL: ${downloadUrl}`);
  
  if (caption) {
    console.log(`📝 Caption: ${caption}`);
  }
  
  // TODO: Add your image processing logic here
}

/**
 * Handle video message
 */
async function handleVideoMessage({ messageId, chatId, senderId, senderName, downloadUrl, caption, fileName }) {
  console.log(`🎥 Video message received: ${fileName || 'video'}`);
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
 * Handle message status updates
 */
async function handleMessageStatus(statusData) {
  const { idMessage, status, timestamp, chatId } = statusData;
  
  console.log(`📊 Message ${idMessage} status: ${status}`);
  
  // Status can be: sent, delivered, read, failed, etc.
  switch (status) {
    case 'sent':
      console.log('✅ Message sent successfully');
      break;
    case 'delivered':
      console.log('📨 Message delivered');
      break;
    case 'read':
      console.log('👀 Message read by recipient');
      break;
    case 'failed':
      console.log('❌ Message failed to send');
      break;
  }
}

/**
 * Handle incoming call notifications
 */
async function handleIncomingCall(callData) {
  const { from, timestamp } = callData;
  console.log(`📞 Incoming call from: ${from}`);
  
  // TODO: Handle incoming calls if needed
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
