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
  // CRITICAL: Save command even if it failed (for natural conversation continuity)
  // When user responds with "כן" after a failure, we need to know what failed
  if (!agentResult.toolCalls || agentResult.toolCalls.length === 0) {
    return;
  }
  
  const toolResults = agentResult.toolResults || {};
  let commandToSave = null;
  
  // Find the LAST persistable tool call (successful OR failed)
  // Priority: look for failed attempts first (for natural continuity), then successful
  for (let i = agentResult.toolCalls.length - 1; i >= 0; i--) {
    const call = agentResult.toolCalls[i];
    if (NON_PERSISTED_TOOLS.has(call.tool)) continue;
    
    // Save the last tool call that can be retried, regardless of success
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
    prompt: userText,
    failed: !commandToSave.success  // Mark if this command failed
  };
  
  await conversationManager.saveLastCommand(chatId, primaryTool, argsToStore, {
    normalized: input,
    imageUrl: sanitizedResult?.imageUrl || agentResult.imageUrl || null,
    videoUrl: sanitizedResult?.videoUrl || agentResult.videoUrl || null,
    audioUrl: sanitizedResult?.audioUrl || agentResult.audioUrl || null
  });
  
  console.log(`💾 [AGENT ROUTER] Saved last command for retry: ${primaryTool} (success: ${commandToSave.success})`);
}

module.exports = {
  saveLastCommand
};

