/**
 * Agent Pilot - Direct routing to Agent (bypassing intentRouter)
 * 
 * This is a pilot implementation that sends ALL requests directly to the Agent,
 * skipping both Regex heuristics and LLM Router prompt.
 * 
 * The Agent (via Gemini Functions API) will handle ALL intent detection and routing.
 */

const { executeAgentQuery } = require('./agentService');

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
  
  // Add media context if present
  if (input.hasImage) {
    contextualPrompt = `[המשתמש שלח תמונה] ${userText}`;
  } else if (input.hasVideo) {
    contextualPrompt = `[המשתמש שלח וידאו] ${userText}`;
  } else if (input.hasAudio) {
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
  
  return agentResult;
}

module.exports = {
  routeToAgent
};

