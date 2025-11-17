/**
 * Incoming Message Handler
 * 
 * Handles incoming WhatsApp messages from users.
 * Extracted from whatsappRoutes.js (Phase 5.3)
 */

// Import services
const { sendTextMessage, sendFileByUrl, getMessage } = require('../../services/greenApiService');
const { getStaticFileUrl } = require('../../utils/urlUtils');
const { cleanMediaDescription } = require('../../utils/textSanitizer');
const conversationManager = require('../../services/conversationManager');
const { routeToAgent } = require('../../services/agentRouter');
const { executeAgentQuery } = require('../../services/agentService');

// Import WhatsApp utilities
const { cleanAgentText } = require('../../services/whatsapp/utils');
const { isAuthorizedForMediaCreation } = require('../../services/whatsapp/authorization');
const { handleQuotedMessage } = require('./quotedMessageHandler');

// Import Green API service (for getMessage fallback)
const greenApiService = require('../../services/greenApiService');

/**
 * Handle incoming WhatsApp message
 * @param {Object} webhookData - Webhook data from Green API
 * @param {Set} processedMessages - Shared cache for message deduplication
 */
async function handleIncomingMessage(webhookData, processedMessages) {
  try {
    const messageData = webhookData.messageData;
    const senderData = webhookData.senderData;
    
    // Extract message ID for deduplication
    let messageId = webhookData.idMessage;
    
    // For edited messages, append suffix to ensure they're processed even if original was processed
    if (messageData.typeMessage === 'editedMessage') {
      messageId = `${messageId}_edited_${Date.now()}`;
      console.log(`✏️ Edited message - using unique ID for reprocessing: ${messageId}`);
    }
    
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
    const senderContactName = senderData.senderContactName || "";
    const chatName = senderData.chatName || "";
    
    // Handle text messages (regular, extended, quoted, and edited)
    let messageText = null;
    
    if (messageData.typeMessage === 'textMessage') {
      messageText = messageData.textMessageData?.textMessage;
    } else if (messageData.typeMessage === 'extendedTextMessage') {
      messageText = messageData.extendedTextMessageData?.text;
    } else if (messageData.typeMessage === 'quotedMessage') {
      // When replying to a message, the text is in extendedTextMessageData
      messageText = messageData.extendedTextMessageData?.text;
      // BUT: If this is actually an image/video/sticker with caption (not a reply), extract the caption
      if (!messageText) {
        messageText = messageData.fileMessageData?.caption || 
                     messageData.imageMessageData?.caption || 
                     messageData.videoMessageData?.caption ||
                     messageData.stickerMessageData?.caption;
      }
    } else if (messageData.typeMessage === 'editedMessage') {
      // Handle edited messages - treat them as regular messages
      messageText = messageData.editedMessageData?.textMessage;
      console.log(`✏️ Edited message detected: "${messageText}"`);
    } else if (messageData.typeMessage === 'imageMessage') {
      // 🆕 Extract caption from image messages
      messageText = messageData.fileMessageData?.caption || messageData.imageMessageData?.caption;
    } else if (messageData.typeMessage === 'videoMessage') {
      // 🆕 Extract caption from video messages
      messageText = messageData.fileMessageData?.caption || messageData.videoMessageData?.caption;
    } else if (messageData.typeMessage === 'stickerMessage') {
      // 🆕 Extract caption from sticker messages (rare but possible)
      messageText = messageData.fileMessageData?.caption || messageData.stickerMessageData?.caption;
    }
    
    // Enhanced logging for incoming messages
    console.log(`📱 Incoming from ${senderName} | Type: ${messageData.typeMessage}${messageData.typeMessage === 'editedMessage' ? ' ✏️' : ''}`);
    if (messageText) {
      console.log(`   Text: ${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}`);
    }
    if (messageData.typeMessage === 'imageMessage') {
      const caption = messageData.fileMessageData?.caption || messageData.imageMessageData?.caption;
      console.log(`   Image Caption: ${caption || 'N/A'}`);
    }
    if (messageData.typeMessage === 'stickerMessage') {
      const caption = messageData.fileMessageData?.caption;
      console.log(`   Sticker Caption: ${caption || 'N/A'} (treating as image)`);
    }
    if (messageData.typeMessage === 'videoMessage') {
      const caption = messageData.fileMessageData?.caption || messageData.videoMessageData?.caption;
      console.log(`   Video Caption: ${caption || 'N/A'}`);
    }
    if (messageData.typeMessage === 'quotedMessage' && messageData.quotedMessage) {
      console.log(`   Quoted Message Type: ${messageData.quotedMessage.typeMessage}`);
      if (messageData.quotedMessage.textMessage) {
        console.log(`   Quoted Text: ${messageData.quotedMessage.textMessage.substring(0, 50)}...`);
      }
      if (messageData.quotedMessage.caption) {
        console.log(`   Quoted Caption: ${messageData.quotedMessage.caption.substring(0, 50)}...`);
      }
    }
    
    // Unified intent router for commands that start with "# "
    if (messageText && /^#\s+/.test(messageText.trim())) {
      try {
        // Extract the prompt (remove "# " prefix if exists)
        // For edited messages, # might be removed by WhatsApp/Green API
        const basePrompt = messageText.trim().replace(/^#\s+/, '').trim();
        
        // Check if this is a quoted/replied message
        // Only process quotedMessage if typeMessage is 'quotedMessage' (actual reply)
        // Don't process if it's just extendedTextMessage with leftover quotedMessage metadata
        const quotedMessage = messageData.quotedMessage;
        
        // IMPORTANT: Green API sends images/videos with captions as quotedMessage, but they're NOT actual quotes!
        // Check if this is a REAL quote (reply) or just a media message with caption
        // Logic:
        // - If caption exists AND matches/starts with the text → It's a NEW media message (not a quote)
        // - If caption doesn't exist OR doesn't match → It's a REAL quote
        const quotedCaption = quotedMessage?.caption;
        const extractedText = messageData.extendedTextMessageData?.text; // Don't shadow messageText!
        // Check if caption matches text (exact match OR caption starts with text, covering "# מה זה..." case)
        const captionMatchesText = quotedCaption && extractedText && 
                                  (quotedCaption === extractedText || 
                                   quotedCaption.startsWith(extractedText) ||
                                   extractedText.startsWith(quotedCaption));
        
        const isActualQuote = messageData.typeMessage === 'quotedMessage' && 
                             quotedMessage && 
                             quotedMessage.stanzaId &&
                             extractedText &&
                             !captionMatchesText; // It's a quote if text doesn't match caption
        
        let finalPrompt = basePrompt;
        let hasImage = messageData.typeMessage === 'imageMessage' || messageData.typeMessage === 'stickerMessage';
        let hasVideo = messageData.typeMessage === 'videoMessage';
        let hasAudio = messageData.typeMessage === 'audioMessage';
        let imageUrl = null;
        let videoUrl = null;
        let audioUrl = null;
        
        // 🆕 Extract URLs for direct media messages (imageMessage/videoMessage/audioMessage)
        if (messageData.typeMessage === 'imageMessage' || messageData.typeMessage === 'stickerMessage') {
          imageUrl = messageData.downloadUrl || 
                    messageData.fileMessageData?.downloadUrl || 
                    messageData.imageMessageData?.downloadUrl ||
                    messageData.stickerMessageData?.downloadUrl;
          console.log(`📸 Incoming: Direct image message, downloadUrl: ${imageUrl ? 'found' : 'NOT FOUND'}`);
        } else if (messageData.typeMessage === 'videoMessage') {
          videoUrl = messageData.downloadUrl || 
                    messageData.fileMessageData?.downloadUrl || 
                    messageData.videoMessageData?.downloadUrl;
          console.log(`🎥 Incoming: Direct video message, downloadUrl: ${videoUrl ? 'found' : 'NOT FOUND'}`);
        } else if (messageData.typeMessage === 'audioMessage') {
          audioUrl = messageData.downloadUrl || 
                    messageData.fileMessageData?.downloadUrl || 
                    messageData.audioMessageData?.downloadUrl;
          console.log(`🎵 Incoming: Direct audio message, downloadUrl: ${audioUrl ? 'found' : 'NOT FOUND'}`);
        }
        
        if (isActualQuote) {
          console.log(`🔗 Detected quoted message with stanzaId: ${quotedMessage.stanzaId}`);
          
          // Handle quoted message - merge content
          const quotedResult = await handleQuotedMessage(quotedMessage, basePrompt, chatId);
          
          // Check if there was an error processing the quoted message
          if (quotedResult.error) {
            await sendTextMessage(chatId, quotedResult.error);
            return;
          }
          
          finalPrompt = quotedResult.prompt;
          hasImage = quotedResult.hasImage;
          hasVideo = quotedResult.hasVideo;
          hasAudio = quotedResult.hasAudio;
          imageUrl = quotedResult.imageUrl;
          videoUrl = quotedResult.videoUrl;
          audioUrl = quotedResult.audioUrl;
        } else if (messageData.typeMessage === 'quotedMessage' && quotedMessage) {
          // This is a media message (image/video) with caption, NOT an actual quote
          // Extract downloadUrl from the message itself
          console.log(`📸 Media message with caption (not a quote) - Type: ${quotedMessage.typeMessage || 'unknown'}`);
          
          if (quotedMessage.typeMessage === 'imageMessage' || quotedMessage.typeMessage === 'stickerMessage') {
            hasImage = true;
            // Try all possible locations for downloadUrl
            imageUrl = messageData.downloadUrl || 
                      messageData.fileMessageData?.downloadUrl || 
                      messageData.imageMessageData?.downloadUrl ||
                      messageData.stickerMessageData?.downloadUrl ||
                      quotedMessage.downloadUrl ||
                      quotedMessage.fileMessageData?.downloadUrl ||
                      quotedMessage.imageMessageData?.downloadUrl ||
                      quotedMessage.stickerMessageData?.downloadUrl;
            
            // If still not found, try getMessage to fetch the current message's downloadUrl
            if (!imageUrl) {
              console.log('⚠️ downloadUrl not found in webhook, fetching from Green API...');
              try {
                const currentMessageId = webhookData.idMessage;
                const originalMessage = await greenApiService.getMessage(chatId, currentMessageId);
                imageUrl = originalMessage?.downloadUrl || 
                          originalMessage?.fileMessageData?.downloadUrl || 
                          originalMessage?.imageMessageData?.downloadUrl;
                console.log(`✅ downloadUrl fetched from getMessage: ${imageUrl ? 'found' : 'still NOT FOUND'}`);
              } catch (err) {
                console.log(`❌ Failed to fetch downloadUrl via getMessage: ${err.message}`);
              }
            }
            console.log(`📸 Image with caption detected, final downloadUrl: ${imageUrl ? 'found' : 'NOT FOUND'}`);
          } else if (quotedMessage.typeMessage === 'videoMessage') {
            hasVideo = true;
            videoUrl = messageData.downloadUrl || 
                      messageData.fileMessageData?.downloadUrl || 
                      messageData.videoMessageData?.downloadUrl ||
                      quotedMessage.downloadUrl ||
                      quotedMessage.fileMessageData?.downloadUrl ||
                      quotedMessage.videoMessageData?.downloadUrl;
            
            // If still not found, try getMessage to fetch the current message's downloadUrl
            if (!videoUrl) {
              console.log('⚠️ Video downloadUrl not found in webhook, fetching from Green API...');
              try {
                const currentMessageId = webhookData.idMessage;
                const originalMessage = await greenApiService.getMessage(chatId, currentMessageId);
                videoUrl = originalMessage?.downloadUrl || 
                          originalMessage?.fileMessageData?.downloadUrl || 
                          originalMessage?.videoMessageData?.downloadUrl;
                console.log(`✅ Video downloadUrl fetched from getMessage: ${videoUrl ? 'found' : 'still NOT FOUND'}`);
              } catch (err) {
                console.log(`❌ Failed to fetch video downloadUrl via getMessage: ${err.message}`);
              }
            }
            console.log(`🎥 Video with caption detected, final downloadUrl: ${videoUrl ? 'found' : 'NOT FOUND'}`);
          }
        }
        
        // Prepare quoted context for Agent (if quoted message exists)
        let quotedContext = null;
        if (isActualQuote && quotedMessage) {
          quotedContext = {
            type: quotedMessage.typeMessage || 'unknown',
            text: quotedMessage.textMessage || quotedMessage.caption || '',
            hasImage: quotedMessage.typeMessage === 'imageMessage' || quotedMessage.typeMessage === 'stickerMessage',
            hasVideo: quotedMessage.typeMessage === 'videoMessage',
            hasAudio: quotedMessage.typeMessage === 'audioMessage',
            imageUrl: imageUrl || null,
            videoUrl: videoUrl || null,
            audioUrl: audioUrl || null, // Include audio URL if available
            stanzaId: quotedMessage.stanzaId
          };
        }
        
        const normalized = {
          userText: `# ${finalPrompt}`, // Add back the # prefix for router
          hasImage: hasImage,
          hasVideo: hasVideo,
          hasAudio: hasAudio,
          imageUrl: imageUrl, // 🆕 Pass media URLs to Agent
          videoUrl: videoUrl, // 🆕 Pass media URLs to Agent
          audioUrl: audioUrl, // 🆕 Pass media URLs to Agent
          quotedContext: quotedContext, // 🆕 Quoted message info for Agent
          chatType: chatId && chatId.endsWith('@g.us') ? 'group' : chatId && chatId.endsWith('@c.us') ? 'private' : 'unknown',
          language: 'he',
          authorizations: {
            media_creation: await isAuthorizedForMediaCreation({ senderContactName, chatName, senderName, chatId }),
            // group_creation and voice_allowed will be checked only when needed (lazy evaluation)
            group_creation: null,
            voice_allowed: null
          },
          // Pass sender data for lazy authorization checks
          senderData: { senderContactName, chatName, senderName, chatId, senderId }
        };

        // ═══════════════════ AGENT MODE (Gemini Function Calling) ═══════════════════
        // All requests are routed directly to the Agent for intelligent tool selection
        console.log('🤖 [AGENT] Processing request with Gemini Function Calling');
        
        try {
            // 🧠 CRITICAL: Save user message to conversation history BEFORE processing
            // This ensures continuity and allows the bot to see the full conversation
            await conversationManager.addMessage(chatId, 'user', normalized.userText);
            console.log(`💾 [Agent] Saved user message to conversation history`);
            
            const agentResult = await routeToAgent(normalized, chatId);
            
            if (agentResult.success) {
              // 🚀 CRITICAL: For multi-step, results are sent immediately after each step in agentService
              // If alreadySent is true, skip sending here to avoid duplicates
              if (agentResult.multiStep && agentResult.alreadySent) {
                console.log(`✅ [Multi-step] Results already sent immediately after each step - skipping duplicate sending`);
                console.log(`✅ [Agent] Completed successfully (${agentResult.iterations || 1} iterations, ${agentResult.toolsUsed?.length || 0} tools used)`);
                return; // Exit early - everything already sent
              }
              
              // Send any generated media (image/video/audio/poll) with captions
              let mediaSent = false;
              
              // Debug: Check multi-step status
              console.log(`🔍 [Debug] multiStep: ${agentResult.multiStep}, text length: ${agentResult.text?.length || 0}, hasImage: ${!!agentResult.imageUrl}`);
              
              // Multi-step: Send text FIRST, then media
              if (agentResult.multiStep && agentResult.text && agentResult.text.trim()) {
                let cleanText = agentResult.text
                  .replace(/https?:\/\/[^\s]+/gi, '') // Remove URLs (image URLs should not be in text)
                  .replace(/\[image\]/gi, '')
                  .replace(/\[video\]/gi, '')
                  .replace(/\[audio\]/gi, '')
                  .replace(/\[תמונה\]/gi, '')
                  .replace(/\[וידאו\]/gi, '')
                  .replace(/\[אודיו\]/gi, '')
                  .trim();
                if (cleanText) {
                  await sendTextMessage(chatId, cleanText);
                  console.log(`📤 [Multi-step] Text sent first (${cleanText.length} chars)`);
                } else {
                  console.warn(`⚠️ [Multi-step] Text exists but cleanText is empty`);
                }
              } else {
                console.warn(`⚠️ [Multi-step] Text not sent - multiStep: ${agentResult.multiStep}, text: ${!!agentResult.text}, trimmed: ${!!agentResult.text?.trim()}`);
              }
              
              // CRITICAL: Send media if URLs exist (Rule: Media MUST be sent!)
              if (agentResult.imageUrl) {
                // CRITICAL: For multi-step with alreadySent=true, image was already sent in agentService
                // Only send here if NOT multi-step or if alreadySent is false
                if (agentResult.multiStep && agentResult.alreadySent) {
                  console.log(`✅ [Multi-step] Image already sent in agentService - skipping duplicate`);
                } else {
                  console.log(`📸 [Agent] Sending generated image: ${agentResult.imageUrl}`);
                  
                  let caption = '';
                  
                  // Multi-step: Use imageCaption if exists (LLM should return it in correct language)
                  if (agentResult.multiStep) {
                    // For multi-step, use imageCaption if it exists
                    // LLM is responsible for returning caption in correct language
                    caption = (agentResult.imageCaption && agentResult.imageCaption.trim()) || '';
                    // Clean markdown/code blocks from caption
                    if (caption) {
                      caption = cleanMediaDescription(caption);
                      console.log(`📤 [Multi-step] Image sent with caption: "${caption.substring(0, 50)}..."`);
                    } else {
                      console.log(`📤 [Multi-step] Image sent after text (no caption)`);
                    }
                  } else {
                    // Single-step: Images support captions - use them!
                    // CRITICAL: If multiple tools were used, don't mix outputs!
                    // Only use imageCaption (specific) or text if it's the ONLY output
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
                  
                  await sendFileByUrl(chatId, agentResult.imageUrl, `agent_image_${Date.now()}.png`, caption);
                  mediaSent = true;
                }
              }
              
              // CRITICAL: Send video if URL exists (Rule: Media MUST be sent!)
              // For multi-step, video is already sent in agentService - skip here
              if (agentResult.multiStep && agentResult.alreadySent) {
                console.log(`⏭️ [Agent] Skipping video send - already sent in multi-step`);
              } else if (agentResult.videoUrl) {
                console.log(`🎬 [Agent] Sending generated video: ${agentResult.videoUrl}`);
                // Videos don't support captions well - send as file, text separately
                await sendFileByUrl(chatId, agentResult.videoUrl, `agent_video_${Date.now()}.mp4`, '');
                mediaSent = true;
                
                // If there's meaningful text (description/revised prompt), send it separately
                if (agentResult.text && agentResult.text.trim()) {
                  const videoDescription = cleanMediaDescription(agentResult.text);
                  if (videoDescription && videoDescription.length > 2) {
                    await sendTextMessage(chatId, videoDescription);
                  }
                }
              }
              
              // CRITICAL: Send audio if URL exists (Rule: Media MUST be sent!)
              // For multi-step, audio is already sent in agentService - skip here
              if (agentResult.multiStep && agentResult.alreadySent) {
                console.log(`⏭️ [Agent] Skipping audio send - already sent in multi-step`);
              } else if (agentResult.audioUrl) {
                console.log(`🎵 [Agent] Sending generated audio: ${agentResult.audioUrl}`);
                // Audio doesn't support captions - send as file only
                const fullAudioUrl = agentResult.audioUrl.startsWith('http') 
                  ? agentResult.audioUrl 
                  : getStaticFileUrl(agentResult.audioUrl.replace('/static/', ''));
                await sendFileByUrl(chatId, fullAudioUrl, `agent_audio_${Date.now()}.mp3`, '');
                mediaSent = true;
                
                // For audio files (TTS/translate_and_speak), don't send text - the audio IS the response
                // No need for textual descriptions like "הנה הקלטה קולית..."
              }
              
              // For multi-step, poll is already sent in agentService - skip here
              if (agentResult.multiStep && agentResult.alreadySent) {
                console.log(`⏭️ [Agent] Skipping poll send - already sent in multi-step`);
              } else if (agentResult.poll) {
                console.log(`📊 [Agent] Sending poll: ${agentResult.poll.question}`);
                // Convert options to Green API format
                const pollOptions = agentResult.poll.options.map(opt => ({ optionName: opt }));
                const { sendPoll } = require('../../services/greenApiService');
                await sendPoll(chatId, agentResult.poll.question, pollOptions, false);
                mediaSent = true;
              }
              
              // For multi-step, location is already sent in agentService - skip here
              if (agentResult.multiStep && agentResult.alreadySent) {
                console.log(`⏭️ [Agent] Skipping location send - already sent in multi-step`);
              } else if (agentResult.latitude && agentResult.longitude) {
                console.log(`📍 [Agent] Sending location: ${agentResult.latitude}, ${agentResult.longitude}`);
                const { sendLocation } = require('../../services/greenApiService');
                await sendLocation(chatId, parseFloat(agentResult.latitude), parseFloat(agentResult.longitude), '', '');
                mediaSent = true;
                // Send location info as separate text message
                if (agentResult.locationInfo && agentResult.locationInfo.trim()) {
                  await sendTextMessage(chatId, `📍 ${agentResult.locationInfo}`);
                }
              }
              
              // Single-step: If no media was sent and it's not multi-step, send text response (אם יש)
              // Multi-step text was already sent above
              if (!agentResult.multiStep && !mediaSent && agentResult.text && agentResult.text.trim()) {
                const multipleTools = (agentResult.toolsUsed && agentResult.toolsUsed.length > 1);
                
                if (!multipleTools) {
                  // Single tool → safe to send text
                  const cleanText = cleanAgentText(agentResult.text);
                  if (cleanText) {
                    await sendTextMessage(chatId, cleanText);
                  }
                } else {
                  console.log(`ℹ️ Multiple tools detected - skipping general text to avoid mixing outputs`);
                }
              }
              
              // 🔁 פוסט-עיבוד: אם המשתמש ביקש גם טקסט וגם תמונה, אבל האג'נט החזיר רק טקסט – ניצור תמונה משלימה
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
                      caption
                    );
                  } else {
                    console.warn('⚠️ [Agent Post] Failed to generate complementary image for text+image request');
                  }
                }
              } catch (postError) {
                console.error('❌ [Agent Post] Error while handling text+image multi-step fallback:', postError.message);
              }
              
              // 🧠 CRITICAL: Save bot's response to conversation history for continuity!
              // This allows the bot to see its own previous responses in future requests
              if (agentResult.text && agentResult.text.trim()) {
                await conversationManager.addMessage(chatId, 'assistant', agentResult.text);
                console.log(`💾 [Agent] Saved bot response to conversation history`);
              }
              
              console.log(`✅ [Agent] Completed successfully (${agentResult.iterations || 1} iterations, ${agentResult.toolsUsed?.length || 0} tools used)`);
            } else {
              await sendTextMessage(chatId, `❌ שגיאה: ${agentResult.error || 'לא הצלחתי לעבד את הבקשה'}`);
            }
            return; // Exit early - no need for regular flow
            
          } catch (agentError) {
            console.error('❌ [Agent] Error:', agentError);
            await sendTextMessage(chatId, `❌ שגיאה בעיבוד הבקשה: ${agentError.message}`);
            return;
          }
        

      } catch (error) {
        console.error('❌ Command execution error:', error.message || error);
        await sendTextMessage(chatId, `❌ שגיאה בביצוע הפקודה: ${error.message || error}`);
      }
    }
  } catch (error) {
    console.error('❌ Error handling incoming message:', error.message || error);
  }
}

module.exports = {
  handleIncomingMessage
};

