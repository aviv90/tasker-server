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
  
  console.log(`🤖 [PILOT] Sending to Agent: "${contextualPrompt.substring(0, 100)}..."`);
  
  // Execute agent query
  const agentResult = await executeAgentQuery(contextualPrompt, chatId, {
    maxIterations: 5,
    input: input // Pass full input for agent tools to access
  });
  
  // Save the last successful command for retry functionality
  if (agentResult.success && agentResult.toolsUsed && agentResult.toolsUsed.length > 0) {
    // Save the primary tool that was used (usually the first one)
    const primaryTool = agentResult.toolsUsed[0];
    
    await conversationManager.saveLastCommand(chatId, primaryTool, {
      prompt: userText,
      // Additional context can be added here
    }, {
      normalized: input
    });
    
    console.log(`💾 [PILOT] Saved last command for retry: ${primaryTool}`);
  }
  
  return agentResult;
}

module.exports = {
  routeToAgent
};

