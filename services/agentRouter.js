/**
 * Agent Router - Direct routing to Agent for intelligent tool selection
 * 
 * All requests are sent directly to the Agent (Gemini Function Calling),
 * which handles ALL intent detection and tool routing intelligently.
 * 
 * This is the main routing mechanism - no regex or manual intent detection required.
 */

const { executeAgentQuery } = require('./agentService');
const conversationManager = require('./conversationManager');

const NON_PERSISTED_TOOLS = new Set([
  'retry_last_command',
  'get_chat_history',
  'save_user_preference',
  'get_long_term_memory',
  'transcribe_audio'
]);

const SUMMARY_MAX_LENGTH = 90;

function truncate(text, maxLength = SUMMARY_MAX_LENGTH) {
  if (!text || typeof text !== 'string') return '';
  return text.length > maxLength ? `${text.substring(0, maxLength)}…` : text;
}

function parseJSONSafe(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return null;
  }
}

function sanitizeToolResult(result) {
  if (!result || typeof result !== 'object') return result;
  const allowedKeys = [
    'success',
    'data',
    'error',
    'imageUrl',
    'imageCaption',
    'videoUrl',
    'audioUrl',
    'translation',
    'translatedText',
    'provider',
    'strategy_used',
    'poll',
    'latitude',
    'longitude',
    'locationInfo',
    'text',
    'prompt'
  ];
  return allowedKeys.reduce((acc, key) => {
    if (result[key] !== undefined) {
      acc[key] = result[key];
    }
    return acc;
  }, {});
}

function summarizeLastCommand(lastCommand) {
  if (!lastCommand) return '';
  const { tool } = lastCommand;
  const argsWrapper = lastCommand.args || {};
  const toolArgs = argsWrapper.toolArgs || argsWrapper;
  const result = argsWrapper.result || {};
  
  const parts = [`כלי: ${tool}`];
  
  if (toolArgs.prompt) {
    parts.push(`פרומפט: ${truncate(toolArgs.prompt)}`);
  } else if (toolArgs.text) {
    parts.push(`טקסט: ${truncate(toolArgs.text)}`);
  }
  
  if (toolArgs.target_language || toolArgs.language) {
    parts.push(`שפה: ${toolArgs.target_language || toolArgs.language}`);
  }
  
  if (result.translation || result.translatedText) {
    parts.push(`תרגום: ${truncate(result.translation || result.translatedText)}`);
  }
  
  if (result.imageUrl) {
    parts.push('תמונה: ✅');
  }
  if (result.videoUrl) {
    parts.push('וידאו: ✅');
  }
  if (result.audioUrl) {
    parts.push('אודיו: ✅');
  }
  if (result.provider || toolArgs.provider) {
    parts.push(`ספק: ${result.provider || toolArgs.provider}`);
  }
  
  return parts.join(' | ');
}

/**
 * Route incoming request directly to Agent
 * @param {Object} input - Normalized input from webhook
 * @param {string} chatId - Chat ID for context
 * @returns {Promise<Object>} - Agent execution result
 */
async function routeToAgent(input, chatId) {
  console.log('🚀 [AGENT ROUTER] Routing to Agent for intelligent tool selection');
  
  // Extract the user's prompt/request
  const userText = input.userText || '';
  
  // Fetch last command for context-aware behaviour
  const lastCommandRaw = await conversationManager.getLastCommand(chatId);
  let parsedLastCommand = null;
  if (lastCommandRaw) {
    parsedLastCommand = {
      ...lastCommandRaw,
      args: parseJSONSafe(lastCommandRaw.args),
      normalized: parseJSONSafe(lastCommandRaw.normalized)
    };
  }
  
  // 🧠 Detect if we should skip loading conversation history
  // Skip history ONLY for cases where context is already provided:
  // 1. Media requests (image/video/audio attached) - all context is in the media itself
  // 2. Quoted messages - all context is already in the quoted message
  // 
  // NOTE: Multi-step detection is handled by LLM Planner - no regex needed!
  // NOTE: Media creation keywords - LLM will handle this intelligently
  const shouldSkipHistory = 
    input.hasImage || 
    input.hasVideo || 
    input.hasAudio ||
    input.quotedContext;  // Skip history for quoted messages (context already provided)
  
  // CRITICAL: Load conversation history to maintain context and continuity
  // BUT NOT for the cases above where we already have sufficient context!
  let conversationHistory = '';
  if (!shouldSkipHistory) {
    try {
      const history = await conversationManager.getConversationHistory(chatId);
      if (history && history.length > 0) {
        // Take last 10 messages for context (5 exchanges)
        const recentHistory = history.slice(-10);
        const formattedHistory = recentHistory.map(msg => {
          const role = msg.role === 'user' ? 'משתמש' : 'בוט';
          return `${role}: ${msg.content}`;
        }).join('\n');
        
        if (formattedHistory) {
          conversationHistory = `\n\n[היסטוריית שיחה אחרונה]:\n${formattedHistory}\n`;
          console.log(`🧠 [AGENT ROUTER] Loaded ${recentHistory.length} recent messages for context`);
        }
      }
    } catch (err) {
      console.warn(`⚠️ [AGENT ROUTER] Failed to load conversation history:`, err.message);
      // Continue without history if it fails
    }
  } else {
    const reason = input.quotedContext ? 'quoted message (context already provided)' : 
                   (input.hasImage || input.hasVideo || input.hasAudio) ? 'media attached' : 
                   'unknown';
    console.log(`🎨 [AGENT ROUTER] Skipping history for: ${reason}`);
  }
  
  // Build context for the agent
  let contextualPrompt = userText;
  
  // Add quoted message context if present (super important for retry/edit workflows!)
  if (input.quotedContext) {
    contextualPrompt = `[הודעה מצוטטת: ${input.quotedContext.type}]\n${input.quotedContext.text || ''}\n\n[בקשה נוכחית:]\n${userText}`;
    
    // If quoted message has media, note it WITH URL for direct access
    if (input.quotedContext.hasImage) {
      const imageUrl = input.quotedContext.imageUrl;
      if (imageUrl) {
        // CRITICAL: Provide image URL directly so Agent can analyze or edit without calling get_chat_history
        contextualPrompt = `[הודעה מצוטטת: תמונה - image_url: ${imageUrl}]\n${input.quotedContext.text || '(תמונה)'}\n\n[בקשה נוכחית:]\n${userText}\n\n**IMPORTANT: User quoted an image with image_url provided above. Based on the request:\n- For analysis/questions (מה זה, תאר, explain, analyze, describe, what is): use analyze_image with image_url: "${imageUrl}"\n- For edits (ערוך, שנה, הסר, הוסף, edit, change, remove, add): use edit_image with image_url: "${imageUrl}"\n- DO NOT use retry_last_command unless user explicitly said "נסה שוב" or "שוב"**`;
      } else {
        contextualPrompt = `[הודעה מצוטטת: תמונה]\n${input.quotedContext.text || '(תמונה)'}\n\n[בקשה נוכחית:]\n${userText}`;
      }
    } else if (input.quotedContext.hasVideo) {
      const videoUrl = input.quotedContext.videoUrl;
      if (videoUrl) {
        contextualPrompt = `[הודעה מצוטטת: וידאו - video_url: ${videoUrl}]\n${input.quotedContext.text || '(וידאו)'}\n\n[בקשה נוכחית:]\n${userText}\n\n**IMPORTANT: User quoted a video with video_url provided above. Use analyze_video with video_url: "${videoUrl}" and question parameter from the current request.**`;
      } else {
        contextualPrompt = `[הודעה מצוטטת: וידאו]\n${input.quotedContext.text || '(וידאו)'}\n\n[בקשה נוכחית:]\n${userText}`;
      }
    } else if (input.quotedContext.hasAudio) {
      const audioUrl = input.quotedContext.audioUrl;
      contextualPrompt = `[הודעה מצוטטת: הקלטה קולית - audio_url: ${audioUrl || 'לא זמין'}]\n${input.quotedContext.text || '(הקלטה)'}\n\n[בקשה נוכחית:]\n${userText}\n\n**IMPORTANT: User quoted audio. Use transcribe_audio with audio_url: "${audioUrl}" if available.**`;
    }
  }
  
  // Add current media context if present (WITH URLs!) - CRITICAL FORMAT for Agent to use directly
  if (input.hasImage && !input.quotedContext) {
    if (input.imageUrl) {
      // CRITICAL: Agent must use this URL DIRECTLY without calling get_chat_history!
      contextualPrompt = `${userText}\n\n**IMPORTANT: User attached an image. Based on the request:\n- For analysis/questions (מה זה, תאר, explain, analyze, describe): use analyze_image with image_url: "${input.imageUrl}"\n- For edits/generation with image (ערוך, שנה, הסר, הוסף, edit, change): use edit_image with image_url: "${input.imageUrl}"**`;
    } else {
      contextualPrompt = `[המשתמש שלח תמונה] ${userText}`;
    }
  } else if (input.hasVideo && !input.quotedContext) {
    if (input.videoUrl) {
      contextualPrompt = `${userText}\n\n**IMPORTANT: User attached a video. Use analyze_video with video_url: "${input.videoUrl}" and extract the question from the user's text above.**`;
    } else {
      contextualPrompt = `[המשתמש שלח וידאו] ${userText}`;
    }
  } else if (input.hasAudio && !input.quotedContext) {
    if (input.audioUrl) {
      contextualPrompt = `${userText}\n\n**IMPORTANT: User attached audio. Use transcribe_audio with audio_url: "${input.audioUrl}" to transcribe it first.**`;
    } else {
      contextualPrompt = `[המשתמש שלח הקלטה קולית] ${userText}`;
    }
  }
  
  // Add authorization context (important for agent to know what tools it can use)
  const authContext = [];
  if (input.authorizations?.media_creation) {
    authContext.push('מורשה ליצירת מדיה (תמונות/וידאו/מוזיקה)');
  }
  if (input.authorizations?.group_creation) {
    authContext.push('מורשה ליצירת קבוצות');
  }
  if (input.authorizations?.voice_allowed) {
    authContext.push('מורשה לשימוש בכלי קול');
  }
  
  if (authContext.length > 0) {
    contextualPrompt += `\n\n[הרשאות: ${authContext.join(', ')}]`;
  }

  if (parsedLastCommand) {
    const summary = summarizeLastCommand(parsedLastCommand);
    if (summary) {
      contextualPrompt += `\n\n[פקודה קודמת]: ${summary}`;
    }
  }
  
  // Add conversation history at the end (CRITICAL for continuity!)
  if (conversationHistory) {
    contextualPrompt += conversationHistory;
  }
  
  console.log(`🤖 [AGENT ROUTER] Sending to Agent: "${contextualPrompt.substring(0, 150)}..."`);
  
  // Execute agent query
  // Note: maxIterations is auto-determined by agentService based on request complexity
  // Multi-step requests get 10 iterations, regular requests get 8
  const agentResult = await executeAgentQuery(contextualPrompt, chatId, {
    // Don't override maxIterations - let agentService decide based on request type
    input: {
      ...input,
      lastCommand: parsedLastCommand
    },
    lastCommand: parsedLastCommand
  });
  
  // Save the last successful command for retry functionality
  if (agentResult.success && agentResult.toolCalls && agentResult.toolCalls.length > 0) {
    const toolResults = agentResult.toolResults || {};
    let commandToSave = null;
    
    for (let i = agentResult.toolCalls.length - 1; i >= 0; i--) {
      const call = agentResult.toolCalls[i];
      if (!call.success) continue;
      if (NON_PERSISTED_TOOLS.has(call.tool)) continue;
      commandToSave = call;
      break;
    }
    
    if (commandToSave) {
      const primaryTool = commandToSave.tool;
      const sanitizedResult = sanitizeToolResult(toolResults[primaryTool]);
      const argsToStore = {
        toolArgs: commandToSave.args || {},
        result: sanitizedResult || null,
        prompt: userText
      };
      
      await conversationManager.saveLastCommand(chatId, primaryTool, argsToStore, {
        normalized: input,
        imageUrl: sanitizedResult?.imageUrl || agentResult.imageUrl || null,
        videoUrl: sanitizedResult?.videoUrl || agentResult.videoUrl || null,
        audioUrl: sanitizedResult?.audioUrl || agentResult.audioUrl || null
      });
      
      console.log(`💾 [AGENT ROUTER] Saved last command for retry: ${primaryTool}`);
    } else {
      console.log('ℹ️ [AGENT ROUTER] No eligible tool call to save as last command');
    }
  }
  
  return agentResult;
}

module.exports = {
  routeToAgent
};

