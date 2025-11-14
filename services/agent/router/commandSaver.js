/**
 * Command Saver
 * Handles saving last command for retry functionality
 */

const conversationManager = require('../../conversationManager');
const { NON_PERSISTED_TOOLS } = require('../config/constants');
const { sanitizeToolResult } = require('../utils/resultUtils');

/**
 * Save last command for retry functionality
 * @param {Object} agentResult - Agent execution result
 * @param {string} chatId - Chat ID
 * @param {string} userText - Original user text
 * @param {Object} input - Normalized input
 */
async function saveLastCommand(agentResult, chatId, userText, input) {
  if (!agentResult.success || !agentResult.toolCalls || agentResult.toolCalls.length === 0) {
    return;
  }
  
  const toolResults = agentResult.toolResults || {};
  let commandToSave = null;
  
  // Find the last successful, persistable tool call
  for (let i = agentResult.toolCalls.length - 1; i >= 0; i--) {
    const call = agentResult.toolCalls[i];
    if (!call.success) continue;
    if (NON_PERSISTED_TOOLS.has(call.tool)) continue;
    commandToSave = call;
    break;
  }
  
  if (!commandToSave) {
    console.log('ℹ️ [AGENT ROUTER] No eligible tool call to save as last command');
    return;
  }
  
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
}

module.exports = {
  saveLastCommand
};

