/**
 * Agent Router - Direct routing to Agent for intelligent tool selection
 * 
 * All requests are sent directly to the Agent (Gemini Function Calling),
 * which handles ALL intent detection and tool routing intelligently.
 * 
 * This is the main routing mechanism - no regex or manual intent detection required.
 */

const { executeAgentQuery } = require('./agentService');
const { buildContextualPrompt } = require('./agent/router/contextBuilder');
const { saveLastCommand } = require('./agent/router/commandSaver');
const logger = require('../utils/logger');

/**
 * Route incoming request directly to Agent
 * @param {Object} input - Normalized input from webhook
 * @param {string} chatId - Chat ID for context
 * @returns {Promise<Object>} - Agent execution result
 */
async function routeToAgent(input, chatId) {
  logger.debug('🚀 [AGENT ROUTER] Routing to Agent for intelligent tool selection');
  
  const userText = input.userText || '';
  
  // Build contextual prompt using the new context builder
  const contextualPrompt = await buildContextualPrompt(input, chatId);
  
  logger.debug(`🤖 [AGENT ROUTER] Sending to Agent: "${contextualPrompt.substring(0, 150)}..."`);
  
  // Get last command for context (needed for agent execution) - from DB (persistent)
  const conversationManager = require('../conversationManager');
  const { parseJSONSafe } = require('./agent/utils/resultUtils');
  const lastCommandRaw = await conversationManager.getLastCommand(chatId);
  let parsedLastCommand = null;
  if (lastCommandRaw) {
    parsedLastCommand = {
      tool: lastCommandRaw.tool,
      args: lastCommandRaw.toolArgs || lastCommandRaw.args,
      normalized: lastCommandRaw.normalized,
      prompt: lastCommandRaw.prompt,
      failed: lastCommandRaw.failed,
      imageUrl: lastCommandRaw.imageUrl,
      videoUrl: lastCommandRaw.videoUrl,
      audioUrl: lastCommandRaw.audioUrl,
      isMultiStep: lastCommandRaw.isMultiStep,
      plan: lastCommandRaw.plan
    };
  }
  
  // Execute agent query
  const agentResult = await executeAgentQuery(contextualPrompt, chatId, {
    input: {
      ...input,
      lastCommand: parsedLastCommand
    },
    lastCommand: parsedLastCommand
  });
  
  // Save the last successful command for retry functionality
  await saveLastCommand(agentResult, chatId, userText, input);
  
  return agentResult;
}

module.exports = {
  routeToAgent
};

