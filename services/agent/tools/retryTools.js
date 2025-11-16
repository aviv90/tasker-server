/**
 * Retry Tools - Command retry functionality
 * Clean, modular tool definitions following SOLID principles
 */

const conversationManager = require('../../conversationManager');
const { getServices } = require('../utils/serviceLoader');
const { getToolAckMessage } = require('../utils/ackUtils');

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
async function sendRetryAck(chatId, tool, provider) {
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
      await greenApiService.sendTextMessage(chatId, ackMessage);
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
    description: 'חזור על הפקודה האחרונה של המשתמש, עם אפשרות לשנות ספק או פרמטרים. השתמש כשהמשתמש אומר "נסה שוב", "שוב", "עם OpenAI", "עם Gemini", "תקן", וכו\'.',
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
      let provider = args.provider_override;
      if (provider === 'none' || !provider) {
        // Keep original provider if exists
        provider = originalArgs.provider || originalArgs.service;
      }
      
      // Send specific ACK based on the tool and provider being retried
      await sendRetryAck(context.chatId, tool, provider);
      
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
          provider: provider || 'gemini'
        };
        
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
          provider: provider || 'kling'
        };
        
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
          service: provider || originalArgs.service || 'openai'
        };
        
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

