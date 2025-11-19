const express = require('express');
const router = express.Router();
const { whatsappLimiter } = require('../middleware/rateLimiter');
const { sendTextMessage, sendFileByUrl, downloadFile, getChatHistory, getMessage, sendPoll, sendLocation } = require('../services/greenApiService');
const { getStaticFileUrl } = require('../utils/urlUtils');
const { cleanMediaDescription } = require('../utils/textSanitizer');
const locationService = require('../services/locationService');
const conversationManager = require('../services/conversationManager');
const { routeToAgent } = require('../services/agentRouter');
const { executeAgentQuery } = require('../services/agentService');
const authStore = require('../store/authStore');
const groupAuthStore = require('../store/groupAuthStore');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Import WhatsApp service constants
const {
  IMAGE_EDIT_PATTERN,
  IMAGE_IMPLICIT_EDIT_PATTERN,
  TTS_KEYWORDS_PATTERN,
  TRANSLATE_KEYWORDS_PATTERN,
  JUST_TRANSCRIPTION_PATTERN,
  MIN_DURATION_FOR_CLONING,
  ELEVENLABS_TTS_DEFAULTS,
  TRANSCRIPTION_DEFAULTS,
  CHAT_HISTORY_LIMIT
} = require('../services/whatsapp/constants');

// Import WhatsApp utility functions
const {
  cleanAgentText,
  cleanForLogging,
  isLandLocation,
  formatChatHistoryForContext
} = require('../services/whatsapp/utils');

// Import WhatsApp authorization functions
const {
  isAuthorizedForMediaCreation,
  isAuthorizedForGroupCreation,
  requiresMediaAuthorization,
  isAdminCommand,
  sendUnauthorizedMessage
} = require('../services/whatsapp/authorization');

// Import WhatsApp media handlers
const {
  handleImageEdit,
  handleImageToVideo,
  handleVideoToVideo,
  handleVoiceMessage
} = require('../services/whatsapp/mediaHandlers');

// Import WhatsApp messaging functions
const { sendAck } = require('../services/whatsapp/messaging');

// Import WhatsApp route handlers (Phase 4.6)
const { saveLastCommand, applyProviderOverride } = require('./whatsapp/commandHandler');
const { handleQuotedMessage } = require('./whatsapp/quotedMessageHandler');
const { processImageEditAsync, processImageToVideoAsync, processVoiceMessageAsync, processVideoToVideoAsync } = require('./whatsapp/asyncProcessors');

// Import WhatsApp handlers (Phase 5.3)
const { handleIncomingMessage } = require('./whatsapp/incomingHandler');
const { handleOutgoingMessage } = require('./whatsapp/outgoingHandler');
const { handleManagementCommand } = require('./whatsapp/managementHandler');

// Message deduplication cache - prevent processing duplicate messages
const processedMessages = new Set();

// Clean up old processed messages cache every 30 minutes
setInterval(() => {
  if (processedMessages.size > 1000) {
    processedMessages.clear();
    console.log('🧹 Cleared processed messages cache');
  }
}, 30 * 60 * 1000);

/**
 * Webhook endpoint for receiving WhatsApp messages from Green API
 * Higher rate limit for legitimate WhatsApp traffic
 */
router.post('/webhook', whatsappLimiter, async (req, res) => {
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
    
    // Log full webhook payload for debugging
    console.log(`📱 Green API webhook: ${webhookData.typeWebhook || 'unknown'} | Type: ${webhookData.messageData?.typeMessage || 'N/A'}`);

    // Handle different webhook types asynchronously
    if (webhookData.typeWebhook === 'incomingMessageReceived') {
      // Process in background - don't await
      handleIncomingMessage(webhookData, processedMessages).catch(error => {
        console.error('❌ Error in async webhook processing:', error.message || error);
      });
    } else if (webhookData.typeWebhook === 'outgoingMessageReceived') {
      // Process outgoing messages (commands sent by you)
      handleOutgoingMessage(webhookData, processedMessages).catch(error => {
        console.error('❌ Error in async outgoing message processing:', error.message || error);
      });
    }

    // Return 200 OK immediately
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('❌ Error processing webhook:', error.message || error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// handleIncomingMessage extracted to routes/whatsapp/incomingHandler.js (Phase 5.3)
// handleOutgoingMessage extracted to routes/whatsapp/outgoingHandler.js (Phase 5.3)
// handleManagementCommand extracted to routes/whatsapp/managementHandler.js (Phase 5.3)

module.exports = router;
