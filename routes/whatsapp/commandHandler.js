async function saveLastCommand(chatId, decision, options = {}) {
  // Don't save retry, clarification, or denial commands
  if (['retry_last_command', 'ask_clarification', 'deny_unauthorized'].includes(decision.tool)) {
    return;
  }
  
  // Save to database for persistence across restarts
  await conversationManager.saveLastCommand(chatId, decision.tool, decision.args, {
    normalized: options.normalized,
    imageUrl: options.imageUrl,
    videoUrl: options.videoUrl,
    audioUrl: options.audioUrl
  });
}

function applyProviderOverride(additionalInstructions, currentDecision, context = {}) {
  if (!additionalInstructions || !additionalInstructions.trim()) return null;

  const text = additionalInstructions.toLowerCase();
  const wantsOpenAI = /openai|אוופנאי|אופן איי/i.test(additionalInstructions);
  const wantsGemini = /gemini|ג׳מיני|גמיני|גימיני/i.test(additionalInstructions);
  const wantsGrok   = /grok|גרוק/i.test(additionalInstructions);
  const wantsSora   = /sora|סורה/i.test(additionalInstructions);
  const wantsVeo    = /veo\s*3?(?:\.\d+)?|veo|ויו|וֶאו/i.test(additionalInstructions);
  const wantsKling  = /kling|קלינג/i.test(additionalInstructions);

  // Sora model variants
  const wantsSoraPro = /sora\s*2\s*pro|sora-2-pro|סורה\s*2\s*פרו|סורה-?2-?פרו/i.test(additionalInstructions);
  const wantsSora2   = /sora\s*2\b|sora-2\b|סורה\s*2|סורה-?2/i.test(additionalInstructions);

  // Decide new tool by media context and provider intent
  const { hasImage, hasVideo } = context;
  const originalTool = currentDecision?.tool || '';

  const cloneArgs = (args) => ({ ...(args || {}) });

  // Image-to-video intents with image present
  if (hasImage && (wantsSora || wantsVeo || wantsKling)) {
    if (wantsSora) {
      return {
        tool: 'sora_image_to_video',
        args: { ...cloneArgs(currentDecision.args), model: wantsSoraPro ? 'sora-2-pro' : (wantsSora2 ? 'sora-2' : (currentDecision.args?.model || 'sora-2')), service: 'openai' },
        reason: 'Retry override → Sora image-to-video'
      };
    }
    if (wantsVeo) {
      return {
        tool: 'veo3_image_to_video',
        args: { ...cloneArgs(currentDecision.args), model: currentDecision.args?.model || 'veo-3', service: 'gemini' },
        reason: 'Retry override → Veo image-to-video'
      };
    }
    if (wantsKling) {
      return {
        tool: 'kling_image_to_video',
        args: { ...cloneArgs(currentDecision.args), model: currentDecision.args?.model || 'kling-1', service: 'kling' },
        reason: 'Retry override → Kling image-to-video'
      };
    }
  }

  // Text-to-image
  if (!hasImage && /image|תמונה|צייר|ציור|צור.*תמונה|תייצר.*תמונה|תייצרי.*תמונה/i.test(additionalInstructions)) {
    if (wantsOpenAI) return { tool: 'openai_image', args: cloneArgs(currentDecision.args), reason: 'Retry override → OpenAI image' };
    if (wantsGemini) return { tool: 'gemini_image', args: cloneArgs(currentDecision.args), reason: 'Retry override → Gemini image' };
    if (wantsGrok)   return { tool: 'grok_image',   args: cloneArgs(currentDecision.args), reason: 'Retry override → Grok image' };
  }

  // Generic provider swap preserving tool family
  
  // Image editing
  if (originalTool.endsWith('_image_edit') || originalTool === 'image_edit') {
    if (wantsOpenAI) return { tool: 'image_edit', args: { ...cloneArgs(currentDecision.args), service: 'openai' }, reason: 'Retry override → OpenAI image edit' };
    if (wantsGemini) return { tool: 'image_edit', args: { ...cloneArgs(currentDecision.args), service: 'gemini' }, reason: 'Retry override → Gemini image edit' };
  }
  
  // Video editing
  if (originalTool.endsWith('_video_edit') || originalTool === 'video_to_video') {
    if (wantsSora) return { tool: 'video_to_video', args: { ...cloneArgs(currentDecision.args), service: 'openai' }, reason: 'Retry override → Sora video' };
    if (wantsVeo) return { tool: 'video_to_video', args: { ...cloneArgs(currentDecision.args), service: 'gemini' }, reason: 'Retry override → Veo video' };
    if (wantsKling) return { tool: 'video_to_video', args: { ...cloneArgs(currentDecision.args), service: 'kling' }, reason: 'Retry override → Kling video' };
  }
  
  // Image generation (not editing)
  if (originalTool.endsWith('_image') && !originalTool.endsWith('_image_edit')) {
    if (wantsOpenAI) return { tool: 'openai_image', args: cloneArgs(currentDecision.args), reason: 'Retry override → OpenAI image' };
    if (wantsGemini) return { tool: 'gemini_image', args: cloneArgs(currentDecision.args), reason: 'Retry override → Gemini image' };
    if (wantsGrok)   return { tool: 'grok_image',   args: cloneArgs(currentDecision.args), reason: 'Retry override → Grok image' };
  }

  // Image-to-video
  if (originalTool.endsWith('_image_to_video')) {
    if (wantsSora)   return { tool: 'sora_image_to_video',  args: { ...cloneArgs(currentDecision.args), model: wantsSoraPro ? 'sora-2-pro' : (wantsSora2 ? 'sora-2' : (currentDecision.args?.model || 'sora-2')) }, reason: 'Retry override → Sora image-to-video' };
    if (wantsVeo)    return { tool: 'veo3_image_to_video',  args: cloneArgs(currentDecision.args), reason: 'Retry override → Veo image-to-video' };
    if (wantsKling)  return { tool: 'kling_image_to_video', args: cloneArgs(currentDecision.args), reason: 'Retry override → Kling image-to-video' };
  }
  
  // Text-to-video
  if (originalTool.endsWith('_video') || originalTool === 'kling_text_to_video') {
    if (wantsSora)   return { tool: 'sora_video',  args: { ...cloneArgs(currentDecision.args), model: wantsSoraPro ? 'sora-2-pro' : (wantsSora2 ? 'sora-2' : (currentDecision.args?.model || 'sora-2')) }, reason: 'Retry override → Sora text-to-video' };
    if (wantsVeo)    return { tool: 'veo3_video',  args: cloneArgs(currentDecision.args), reason: 'Retry override → Veo text-to-video' };
    if (wantsKling)  return { tool: 'kling_text_to_video', args: cloneArgs(currentDecision.args), reason: 'Retry override → Kling text-to-video' };
  }

  // Chat provider swap
  if (originalTool.endsWith('_chat')) {
    if (wantsOpenAI) return { tool: 'openai_chat', args: cloneArgs(currentDecision.args), reason: 'Retry override → OpenAI chat' };
    if (wantsGemini) return { tool: 'gemini_chat', args: cloneArgs(currentDecision.args), reason: 'Retry override → Gemini chat' };
    if (wantsGrok)   return { tool: 'grok_chat',   args: cloneArgs(currentDecision.args), reason: 'Retry override → Grok chat' };
  }

  return null;
}

// formatChatHistoryForContext is now imported from services/whatsapp/utils.js

// Authorization functions moved to services/whatsapp/authorization.js
// Now imported above instead of defined locally

// Clean up old processed messages cache every 30 minutes
setInterval(() => {
  if (processedMessages.size > 1000) {
    processedMessages.clear();
    console.log('🧹 Cleared processed messages cache');
  }
  // Last commands are now persisted in DB, no need to clean up in-memory cache
}, 30 * 60 * 1000);

/**
 * Send immediate acknowledgment for long-running commands
 */
// sendAck function is now imported from services/whatsapp/messaging.js

/**
 * WhatsApp Green API Integration Routes
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
    
    // Log full webhook payload for debugging
    console.log(`📱 Green API webhook: ${webhookData.typeWebhook || 'unknown'} | Type: ${webhookData.messageData?.typeMessage || 'N/A'}`);
    
    // TEMPORARY DEBUG: Log full payload to see what we're missing
    if (webhookData.messageData?.typeMessage) {
      console.log('🔍 FULL WEBHOOK PAYLOAD:', JSON.stringify(webhookData, null, 2));
    }

    // Handle different webhook types asynchronously
    if (webhookData.typeWebhook === 'incomingMessageReceived') {
      // Process in background - don't await
      handleIncomingMessage(webhookData).catch(error => {
        console.error('❌ Error in async webhook processing:', error.message || error);
      });
    } else if (webhookData.typeWebhook === 'outgoingMessageReceived') {
      // Process outgoing messages (commands sent by you)
      handleOutgoingMessage(webhookData).catch(error => {
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

/**
 * Handle quoted (replied) messages
 * Merges quoted message content with current message prompt


module.exports = {
  saveLastCommand,
  applyProviderOverride
};
