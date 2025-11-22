/**
 * Retry Tools - Command retry functionality
 * Clean, modular tool definitions following SOLID principles
 */

const conversationManager = require('../../conversationManager');
const { getServices } = require('../utils/serviceLoader');
const { getToolAckMessage } = require('../utils/ackUtils');
const { extractQuotedMessageId } = require('../../../utils/messageHelpers');

// Reference to agentTools (will be injected)
let agentTools = null;

/**
 * Set agent tools reference (needed for retry)
 * @param {Object} tools - Agent tools object
 */
function setAgentToolsReference(tools) {
  agentTools = tools;
}

/**
 * Send specific ACK message for retry based on tool and provider
 * @param {string} chatId - Chat ID
 * @param {string} tool - Tool name being retried
 * @param {string} provider - Provider to use (optional)
 */
async function sendRetryAck(chatId, tool, provider, quotedMessageId = null) {
  try {
    // Skip ACK for location (no ACK needed)
    if (tool === 'send_location') {
      return;
    }
    
    // Use centralized ACK message function (SSOT - Single Source of Truth)
    const ackMessage = getToolAckMessage(tool, provider);
    
    if (ackMessage) {
      console.log(`📢 [RETRY ACK] ${ackMessage}`);
      const { greenApiService } = getServices();
      await greenApiService.sendTextMessage(chatId, ackMessage, quotedMessageId, 1000);
    }
  } catch (error) {
    console.error('❌ Error sending retry ACK:', error.message);
    // Don't throw - ACK failure shouldn't break retry
  }
}

/**
 * Tool: Retry Last Command
 */
const retry_last_command = {
  declaration: {
    name: 'retry_last_command',
    description: 'חזור על הפקודה האחרונה של המשתמש (retry בלבד!). השתמש רק כשהמשתמש אומר במפורש "נסה שוב", "שוב", "תקן", "retry", "again". אם המשתמש מבקש ליצור משהו חדש (תמונה, וידאו, מוזיקה) עם ספק ספציפי (כמו "צור וידאו עם Veo 3") - זו בקשה חדשה, לא retry! השתמש ב-create_image/create_video/create_music במקום.',
    parameters: {
      type: 'object',
      properties: {
        provider_override: {
          type: 'string',
          enum: ['gemini', 'openai', 'grok', 'sora', 'veo3', 'kling', 'runway', 'none'],
          description: 'ספק חלופי להשתמש (אם המשתמש ביקש). none = אין שינוי'
        },
        modifications: {
          type: 'string',
          description: 'שינויים או הוראות נוספות מהמשתמש (למשל: "עם שיער ארוך", "בלי משקפיים")'
        }
      },
      required: []
    }
  },
  execute: async (args, context) => {
    console.log(`🔧 [Agent Tool] retry_last_command called with provider: ${args.provider_override || 'none'}`);
    
    if (!agentTools) {
      return {
        success: false,
        error: 'שגיאה פנימית: לא ניתן לבצע retry כרגע.'
      };
    }
    
    try {
      // Get last command from DB
      const lastCommand = await conversationManager.getLastCommand(context.chatId);
      
      if (!lastCommand) {
        return {
          success: false,
          error: 'אין פקודה קודמת לחזור עליה. זו הפעם הראשונה שאתה מבקש משהו.'
        };
      }
      
      console.log(`🔄 Last command: ${lastCommand.tool} with args:`, lastCommand.args);
      
      // Map tool names to appropriate retry function
      const tool = lastCommand.tool;
      const storedWrapper = lastCommand.args || {};
      
      // CRITICAL: Check if this is a multi-step command
      if (tool === 'multi_step' || storedWrapper.isMultiStep === true) {
        // Multi-step retry: re-execute all steps from the plan
        const plan = storedWrapper.plan;
        if (!plan || !plan.steps || plan.steps.length === 0) {
          return {
            success: false,
            error: 'לא הצלחתי לשחזר את התוכנית של הפקודה הרב-שלבית הקודמת.'
          };
        }
        
        console.log(`🔄 Retrying multi-step command: ${plan.steps.length} steps`);
        
        // Get multi-step execution handler
        const multiStepExecution = require('../execution/multiStep');
        const { getLanguageInstruction } = require('../../utils/languageUtils');
        const { detectLanguage } = require('../../../utils/agentHelpers');
        
        // Detect language from original prompt
        const originalPrompt = storedWrapper.prompt || '';
        const userLanguage = detectLanguage(originalPrompt);
        const languageInstruction = getLanguageInstruction(userLanguage);
        
        // Agent config
        const agentConfig = {
          model: process.env.AGENT_MODEL || 'gemini-2.5-flash',
          maxIterations: Number(process.env.AGENT_MAX_ITERATIONS) || 8,
          timeoutMs: Number(process.env.AGENT_TIMEOUT_MS) || 240000,
          contextMemoryEnabled: String(process.env.AGENT_CONTEXT_MEMORY_ENABLED || 'false').toLowerCase() === 'true'
        };
        
        // Apply modifications to plan if provided
        if (args.modifications && args.modifications.trim()) {
          // Modify the first step's action to include modifications
          if (plan.steps && plan.steps.length > 0) {
            plan.steps[0].action = `${plan.steps[0].action} ${args.modifications}`;
            console.log(`📝 Applied modifications to multi-step plan: ${args.modifications}`);
          }
        }
        
        // CRITICAL: For manual retry, preserve original providers in each step
        // Only change provider if user explicitly specified provider_override
        if (args.provider_override && args.provider_override !== 'none') {
          // User explicitly requested different provider - apply to all steps that support it
          console.log(`🔄 [Multi-step Retry] User requested provider override: ${args.provider_override}`);
          if (plan.steps) {
            plan.steps.forEach((step, idx) => {
              if (step.parameters) {
                // Only override provider for creation tools
                const toolName = step.tool || '';
                if (toolName.includes('image') || toolName.includes('video') || toolName.includes('edit')) {
                  step.parameters.provider = args.provider_override;
                  step.parameters.service = args.provider_override;
                  console.log(`🔄 [Multi-step Retry] Overriding provider for step ${idx + 1} to: ${args.provider_override}`);
                }
              }
            });
          }
        } else {
          // No provider override - keep original providers from saved plan
          // The plan already contains the original providers, so we don't need to change anything
          console.log(`🔄 [Multi-step Retry] Keeping original providers for all steps`);
        }
        
        // Send ACK
        const quotedMessageId = extractQuotedMessageId({ context });
        const { greenApiService } = getServices();
        await greenApiService.sendTextMessage(
          context.chatId,
          `🔄 חוזר על פקודה רב-שלבית (${plan.steps.length} שלבים)...`,
          quotedMessageId,
          1000
        );
        
        // Re-execute the multi-step plan
        const result = await multiStepExecution.execute(
          plan,
          context.chatId,
          {
            input: {
              ...context.originalInput,
              originalMessageId: quotedMessageId
            }
          },
          languageInstruction,
          agentConfig
        );
        
        return result;
      }
      
      // Single-step command handling
      const originalArgs = (storedWrapper && storedWrapper.toolArgs)
        ? storedWrapper.toolArgs
        : storedWrapper || {};
      const storedResult = (storedWrapper && storedWrapper.result) ? storedWrapper.result : {};
      
      // Build modified prompt if needed
      let modifiedPrompt = originalArgs.prompt || originalArgs.text || storedResult.translation || storedResult.translatedText || '';
      if (args.modifications && args.modifications.trim()) {
        modifiedPrompt = modifiedPrompt
          ? `${modifiedPrompt} ${args.modifications}`
          : args.modifications;
      }
      modifiedPrompt = (modifiedPrompt || '').toString().trim();
      
      // Determine provider override
      // CRITICAL: For manual retry, use the SAME provider as the original command
      // Only change provider if user explicitly specified provider_override
      let provider = args.provider_override;
      if (provider === 'none' || !provider) {
        // Keep original provider from the saved command
        // Try multiple sources to find the original provider
        provider = originalArgs.provider || 
                   originalArgs.service || 
                   storedResult.provider ||
                   storedResult.service ||
                   null; // Don't use default - keep null if not found
        
        // If we still don't have a provider, try to infer from tool name
        if (!provider) {
          if (tool.includes('openai')) provider = 'openai';
          else if (tool.includes('grok')) provider = 'grok';
          else if (tool.includes('gemini')) provider = 'gemini';
          else if (tool.includes('sora')) provider = 'sora';
          else if (tool.includes('veo')) provider = 'veo3';
          else if (tool.includes('kling')) provider = 'kling';
        }
      }
      
      // Send specific ACK based on the tool and provider being retried
      const quotedMessageId = extractQuotedMessageId({ context });
      await sendRetryAck(context.chatId, tool, provider, quotedMessageId);
      
      // Route to appropriate tool based on last command
      if (tool === 'gemini_image' || tool === 'openai_image' || tool === 'grok_image' || tool === 'create_image') {
        // Image generation retry
        const promptToUse = modifiedPrompt || originalArgs.prompt || originalArgs.text || storedResult.prompt || '';
        if (!promptToUse) {
          return {
            success: false,
            error: 'לא הצלחתי לשחזר את הפרומפט של הפקודה הקודמת.'
          };
        }
        
        const imageArgs = {
          prompt: promptToUse,
          provider: provider || 'gemini' // Only use default if provider truly not found
        };
        
        // Log provider being used for debugging
        if (provider) {
          console.log(`🔄 [Retry] Using original provider: ${provider}`);
        } else {
          console.log(`⚠️ [Retry] Original provider not found, using default: gemini`);
        }
        
        console.log(`🎨 Retrying image generation with:`, imageArgs);
        return await agentTools.create_image.execute(imageArgs, context);
        
      } else if (tool === 'veo3_video' || tool === 'sora_video' || tool === 'kling_text_to_video' || tool === 'create_video') {
        // Video generation retry
        const promptToUse = modifiedPrompt || originalArgs.prompt || originalArgs.text || storedResult.prompt || '';
        if (!promptToUse) {
          return {
            success: false,
            error: 'לא הצלחתי לשחזר את הפרומפט של הפקודה הקודמת לוידאו.'
          };
        }
        
        const videoArgs = {
          prompt: promptToUse,
          provider: provider || 'kling' // Only use default if provider truly not found
        };
        
        // Log provider being used for debugging
        if (provider) {
          console.log(`🔄 [Retry] Using original provider: ${provider}`);
        } else {
          console.log(`⚠️ [Retry] Original provider not found, using default: kling`);
        }
        
        console.log(`🎬 Retrying video generation with:`, videoArgs);
        return await agentTools.create_video.execute(videoArgs, context);
        
      } else if (tool === 'edit_image') {
        // Image editing retry
        const editInstruction = modifiedPrompt || originalArgs.edit_instruction || originalArgs.prompt || '';
        const imageUrl = originalArgs.image_url || storedResult.imageUrl;
        
        if (!editInstruction || !imageUrl) {
          return {
            success: false,
            error: 'לא הצלחתי לשחזר את הוראות העריכה או את כתובת התמונה.'
          };
        }
        
        const editArgs = {
          image_url: imageUrl,
          edit_instruction: editInstruction,
          service: provider || originalArgs.service || 'openai' // Only use default if provider truly not found
        };
        
        // Log provider being used for debugging
        if (provider || originalArgs.service) {
          console.log(`🔄 [Retry] Using original service: ${provider || originalArgs.service}`);
        } else {
          console.log(`⚠️ [Retry] Original service not found, using default: openai`);
        }
        
        console.log(`✏️ Retrying image edit with:`, editArgs);
        return await agentTools.edit_image.execute(editArgs, context);
        
      } else if (tool === 'gemini_chat' || tool === 'openai_chat' || tool === 'grok_chat') {
        // Chat retry
        const chatProvider = provider || (tool.includes('openai') ? 'openai' : tool.includes('grok') ? 'grok' : 'gemini');
        
        // For chat, we need to use the appropriate service directly
        const { geminiService, openaiService, grokService } = getServices();
        
        let result;
        if (chatProvider === 'openai') {
          result = await openaiService.generateTextResponse(modifiedPrompt, []);
        } else if (chatProvider === 'grok') {
          result = await grokService.generateTextResponse(modifiedPrompt, []);
        } else {
          result = await geminiService.generateTextResponse(modifiedPrompt, []);
        }
        
        return {
          success: !result.error,
          data: result.text || result.error,
          error: result.error
        };
        
      } else if (tool === 'text_to_speech') {
        // TTS retry
        const textToSpeak = modifiedPrompt || originalArgs.text || storedResult.translation || storedResult.translatedText;
        if (!textToSpeak) {
          return {
            success: false,
            error: 'לא הצלחתי לשחזר את הטקסט להמרה לדיבור.'
          };
        }
        return await agentTools.text_to_speech.execute({
          text: textToSpeak,
          target_language: originalArgs.target_language || originalArgs.language || 'he'
        }, context);
        
      } else if (tool === 'music_generation' || tool === 'create_music') {
        // Music retry
        const promptToUse = modifiedPrompt || originalArgs.prompt || storedResult.prompt || originalArgs.text || '';
        if (!promptToUse) {
          return {
            success: false,
            error: 'לא הצלחתי לשחזר את הפרומפט ליצירת המוזיקה.'
          };
        }
        return await agentTools.create_music.execute({
          prompt: promptToUse
        }, context);
        
      } else if (tool === 'translate_text') {
        const translationArgs = {
          text: originalArgs.text || storedResult.originalText || originalArgs.prompt || '',
          target_language: originalArgs.target_language || originalArgs.language || storedResult.target_language || storedResult.language || 'he'
        };
        
        if (!translationArgs.text || !translationArgs.target_language) {
          return {
            success: false,
            error: 'לא הצלחתי לאחזר את הטקסט או את שפת היעד של הפקודה הקודמת.'
          };
        }
        
        return await agentTools.translate_text.execute(translationArgs, context);
        
      } else if (tool === 'create_poll') {
        // Poll retry
        const topicToUse = modifiedPrompt || originalArgs.topic || originalArgs.prompt || '';
        if (!topicToUse) {
          return {
            success: false,
            error: 'לא הצלחתי לשחזר את נושא הסקר הקודם.'
          };
        }
        return await agentTools.create_poll.execute({
          topic: topicToUse
        }, context);
        
      } else {
        // Generic retry - just return info about what was done
        return {
          success: true,
          data: `הפקודה האחרונה הייתה: ${tool}\n\nלא יכול לחזור עליה אוטומטית, אבל אתה יכול לבקש אותה שוב ישירות.`,
          lastTool: tool,
          lastArgs: originalArgs
        };
      }
      
    } catch (error) {
      console.error('❌ Error in retry_last_command:', error);
      return {
        success: false,
        error: `שגיאה בביצוע חוזר: ${error.message}`
      };
    }
  }
};

module.exports = {
  retry_last_command,
  setAgentToolsReference
};

