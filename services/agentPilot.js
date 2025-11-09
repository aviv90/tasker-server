/**
 * Agent Pilot - Direct routing to Agent (bypassing intentRouter)
 * 
 * This is a pilot implementation that sends ALL requests directly to the Agent,
 * skipping both Regex heuristics and LLM Router prompt.
 * 
 * The Agent (via Gemini Functions API) will handle ALL intent detection and routing.
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
  console.log('🚀 [PILOT] Routing directly to Agent (bypassing intentRouter)');
  
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
  
  // Build context for the agent
  let contextualPrompt = userText;
  
  // Add quoted message context if present (super important for retry/edit workflows!)
  if (input.quotedContext) {
    contextualPrompt = `[הודעה מצוטטת: ${input.quotedContext.type}]\n${input.quotedContext.text || ''}\n\n[בקשה נוכחית:]\n${userText}`;
    
    // If quoted message has media, note it
    if (input.quotedContext.hasImage) {
      contextualPrompt = `[הודעה מצוטטת: תמונה]\n${input.quotedContext.text || '(תמונה)'}\n\n[בקשה נוכחית:]\n${userText}`;
    } else if (input.quotedContext.hasVideo) {
      contextualPrompt = `[הודעה מצוטטת: וידאו]\n${input.quotedContext.text || '(וידאו)'}\n\n[בקשה נוכחית:]\n${userText}`;
    } else if (input.quotedContext.hasAudio) {
      contextualPrompt = `[הודעה מצוטטת: הקלטה קולית - audioUrl: ${input.quotedContext.audioUrl || 'לא זמין'}]\n${input.quotedContext.text || '(הקלטה)'}\n\n[בקשה נוכחית:]\n${userText}`;
    }
  }
  
  // Add current media context if present
  if (input.hasImage && !input.quotedContext) {
    contextualPrompt = `[המשתמש שלח תמונה] ${userText}`;
  } else if (input.hasVideo && !input.quotedContext) {
    contextualPrompt = `[המשתמש שלח וידאו] ${userText}`;
  } else if (input.hasAudio && !input.quotedContext) {
    contextualPrompt = `[המשתמש שלח הקלטה קולית] ${userText}`;
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
  
  console.log(`🤖 [PILOT] Sending to Agent: "${contextualPrompt.substring(0, 100)}..."`);
  
  // Execute agent query
  const agentResult = await executeAgentQuery(contextualPrompt, chatId, {
    maxIterations: 5,
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
      
      console.log(`💾 [PILOT] Saved last command for retry: ${primaryTool}`);
    } else {
      console.log('ℹ️ [PILOT] No eligible tool call to save as last command');
    }
  }
  
  return agentResult;
}

module.exports = {
  routeToAgent
};

