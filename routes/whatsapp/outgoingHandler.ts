/**
 * Outgoing Message Handler
 * 
 * Handles outgoing WhatsApp messages (commands sent by you).
 * Extracted from whatsappRoutes.js (Phase 5.3)
 */

// Import services
import * as greenApiService from '../../services/greenApiService';
import conversationManager from '../../services/conversationManager';
import { routeToAgent } from '../../services/agentRouter';
import { sendErrorToUser, ERROR_MESSAGES } from '../../utils/errorSender';
import logger from '../../utils/logger';

// Import WhatsApp utilities
import { isAdminCommand } from '../../services/whatsapp/authorization';
import { handleManagementCommand } from './managementHandler';
import { handleQuotedMessage } from './quotedMessageHandler';
import { sendAgentResults } from './incoming/resultHandling';
import { detectManagementCommand } from './commandDetector';
import { extractMessageText, extractMediaUrls, extractQuotedMediaUrls, isActualQuote, logMessageDetails, buildQuotedContext } from './messageParser';

/**
 * Handle outgoing WhatsApp message
 * @param {Object} webhookData - Webhook data from Green API
 * @param {Set} processedMessages - Shared cache for message deduplication
 */
export async function handleOutgoingMessage(webhookData: any, processedMessages: Set<string>) {
  try {
    const messageData = webhookData.messageData;
    const senderData = webhookData.senderData;
    
    // Extract message ID for deduplication
    let messageId = webhookData.idMessage;
    
    // For edited messages, append suffix to ensure they're processed even if original was processed
    if (messageData.typeMessage === 'editedMessage') {
      messageId = `${messageId}_edited_${Date.now()}`;
      logger.debug(`✏️ Edited message (outgoing) - using unique ID for reprocessing: ${messageId}`);
    }
    
    // Check if we already processed this message
    if (processedMessages.has(messageId)) {
      logger.debug(`🔄 Duplicate outgoing message detected, skipping: ${messageId}`);
      return;
    }
    
    // Mark message as processed
    processedMessages.add(messageId);
    
    // Mark outgoing message type in cache
    // All outgoing messages from user are marked as user outgoing
    // Commands will be saved to cache separately in commandSaver after processing
    const chatId = senderData.chatId;
    await conversationManager.markAsUserOutgoing(chatId, messageId);
    const senderId = senderData.sender;
    const senderName = senderData.senderName || senderId;
    const senderContactName = senderData.senderContactName || "";
    const chatName = senderData.chatName || "";
    
    // Extract message text using centralized parser (SSOT)
    const messageText = extractMessageText(messageData);
    
    // Log edited messages
    if (messageData.typeMessage === 'editedMessage' && messageText) {
      console.log(`✏️ Edited message detected (outgoing): "${messageText}"`);
    }
    
    // Enhanced logging for outgoing messages
    logMessageDetails(messageData, senderName, messageText);
    
    // Handle management commands (without #, only for outgoing messages)
    // Use centralized command detector (SSOT)
    if (messageText && messageText.trim() && !/^#\s+/.test(messageText.trim())) {
      const managementCommand = detectManagementCommand(messageText, {
        chatId,
        chatName,
        senderName,
        senderContactName
      });

      if (managementCommand && isAdminCommand(managementCommand.type)) {
        try {
          // Get originalMessageId for quoting all management responses
          const originalMessageId = webhookData.idMessage;
          await handleManagementCommand(managementCommand, chatId, senderId, senderName, senderContactName, chatName, originalMessageId);
          return; // Exit early after handling management command
        } catch (error: any) {
          logger.error('❌ Management command error:', { error: error.message || error, stack: error.stack });
          // Get originalMessageId for quoting error
          const originalMessageId = webhookData.idMessage;
          await sendErrorToUser(chatId, error, { context: 'PROCESSING', quotedMessageId: originalMessageId });
          return;
        }
      }
    }
    
    // Unified intent router for outgoing when text starts with "# "
    if (messageText && /^#\s+/.test(messageText.trim())) {
      try {
        const chatId = senderData.chatId;

        // Extract the prompt (remove "# " prefix if exists)
        // For edited messages, # might be removed by WhatsApp/Green API
        const basePrompt = messageText.trim().replace(/^#\s+/, '').trim();
        
        // Check if this is a quoted/replied message using centralized parser
        const quotedMessage = messageData.quotedMessage;
        const actualQuote = isActualQuote(messageData, quotedMessage);
        
        let finalPrompt = basePrompt;
        let hasImage = messageData.typeMessage === 'imageMessage' || messageData.typeMessage === 'stickerMessage';
        let hasVideo = messageData.typeMessage === 'videoMessage';
        let hasAudio = messageData.typeMessage === 'audioMessage';
        
        // Extract media URLs using centralized parser
        const mediaUrls = extractMediaUrls(messageData);
        let imageUrl = mediaUrls.imageUrl;
        let videoUrl = mediaUrls.videoUrl;
        let audioUrl = mediaUrls.audioUrl;
        
        if (imageUrl) {
          console.log(`📸 Outgoing: Direct image message, downloadUrl: found`);
        }
        if (videoUrl) {
          logger.debug(`🎥 Outgoing: Direct video message, downloadUrl: found`);
        }
        if (audioUrl) {
          logger.debug(`🎵 Outgoing: Direct audio message, downloadUrl: found`);
        }
        
        if (actualQuote) {
          logger.debug(`🔗 Outgoing: Detected quoted message with stanzaId: ${quotedMessage.stanzaId}`);
          
          // Handle quoted message - merge content
          const quotedResult = await handleQuotedMessage(quotedMessage, basePrompt, chatId);
          
          // Check if there was an error processing the quoted message
          if (quotedResult.error) {
            const originalMessageId = webhookData.idMessage;
            await greenApiService.sendTextMessage(chatId, quotedResult.error, originalMessageId, 1000);
            return;
          }
          
          finalPrompt = quotedResult.prompt || basePrompt;
          hasImage = quotedResult.hasImage;
          hasVideo = quotedResult.hasVideo;
          hasAudio = quotedResult.hasAudio;
          imageUrl = quotedResult.imageUrl;
          videoUrl = quotedResult.videoUrl;
          audioUrl = quotedResult.audioUrl;
        } else if (messageData.typeMessage === 'quotedMessage' && quotedMessage) {
          // This is a media message (image/video) with caption, NOT an actual quote
          // Extract downloadUrl from the message itself using centralized parser
          console.log(`📸 Outgoing: Media message with caption (not a quote) - Type: ${quotedMessage.typeMessage || 'unknown'}`);
          
          const quotedMedia = await extractQuotedMediaUrls(
            messageData, 
            webhookData, 
            chatId
          );
          
          hasImage = quotedMedia.hasImage ?? false;
          hasVideo = quotedMedia.hasVideo ?? false;
          hasAudio = quotedMedia.hasAudio ?? false;
          imageUrl = quotedMedia.imageUrl || imageUrl;
          videoUrl = quotedMedia.videoUrl || videoUrl;
          audioUrl = quotedMedia.audioUrl || audioUrl;
        }

        // Prepare quoted context for Agent (if quoted message exists) - Outgoing
        // Use centralized builder (SSOT)
        const quotedContext = actualQuote && quotedMessage 
          ? buildQuotedContext(quotedMessage, imageUrl, videoUrl, audioUrl)
          : null;

        // Save original message ID for quoting all bot responses
        const originalMessageId = webhookData.idMessage;

        const normalized: any = {
          userText: `# ${finalPrompt}`, // Add back the # prefix for router
          hasImage: hasImage,
          hasVideo: hasVideo,
          hasAudio: hasAudio,
          imageUrl: imageUrl, // 🆕 Pass media URLs to Agent
          videoUrl: videoUrl, // 🆕 Pass media URLs to Agent
          audioUrl: audioUrl, // 🆕 Pass media URLs to Agent
          quotedContext: quotedContext, // 🆕 Quoted message info for Agent
          originalMessageId: originalMessageId, // Original message ID for quoting bot responses
          chatType: chatId && chatId.endsWith('@g.us') ? 'group' : chatId && chatId.endsWith('@c.us') ? 'private' : 'unknown',
          language: 'he',
          authorizations: {
            // Outgoing bypasses authorization in existing logic, but router still expects booleans
            media_creation: true,
            group_creation: true,
            voice_allowed: true
          }
        };

        // ═══════════════════ AGENT MODE (Gemini Function Calling - OUTGOING) ═══════════════════
        // All outgoing requests are routed directly to the Agent for intelligent tool selection
        console.log('🤖 [AGENT - OUTGOING] Processing request with Gemini Function Calling');
        
        try {
            // NOTE: User messages are no longer saved to DB to avoid duplication.
            // All messages are retrieved from Green API getChatHistory when needed.
            // Commands are saved to DB (persistent) for retry functionality.
            logger.debug(`💾 [Agent - Outgoing] Processing command (not saving to DB - using Green API history)`);
            
            const agentResult: any = await routeToAgent(normalized, chatId);
            
            // Pass originalMessageId to agentResult for use in result handling
            if (agentResult) {
              agentResult.originalMessageId = originalMessageId;
            }
            
            // Get quotedMessageId from agentResult or normalized
            const quotedMessageId = agentResult?.originalMessageId || normalized?.originalMessageId || null;
            
            if (agentResult?.success) {
              // Use centralized result handling (SSOT - eliminates code duplication)
              await sendAgentResults(chatId, agentResult, normalized);
              logger.info(`✅ [Agent - Outgoing] Completed successfully (${agentResult.iterations || 1} iterations, ${agentResult.toolsUsed?.length || 0} tools used)`);
            } else {
              await sendErrorToUser(chatId, agentResult?.error || ERROR_MESSAGES.UNKNOWN, { quotedMessageId });
            }
            return; // Exit early - no need for regular flow
            
          } catch (agentError: any) {
            logger.error('❌ [Agent - Outgoing] Error:', { error: agentError.message, stack: agentError.stack });
            const originalMessageId = webhookData.idMessage;
            await sendErrorToUser(chatId, agentError, { context: 'REQUEST', quotedMessageId: originalMessageId });
            return;
          }
        

      } catch (error: any) {
        console.error('❌ Command execution error (outgoing):', error.message || error);
        const originalMessageId = webhookData.idMessage;
        await sendErrorToUser(chatId, error, { context: 'EXECUTION', quotedMessageId: originalMessageId });
      }
    }
  } catch (error: any) {
    logger.error('❌ Error handling outgoing message:', { error: error.message || error, stack: error.stack });
  }
}
