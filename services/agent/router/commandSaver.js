/**
 * Command Saver
 * Handles saving last command for retry functionality
 * 
 * Commands are saved to DB (persistent) for retry functionality.
 * All messages are retrieved from Green API.
 */

// Handle default export from TypeScript
const conversationManagerModule = require('../../../services/conversationManager');
const conversationManager = conversationManagerModule.default || conversationManagerModule;
const { NON_PERSISTED_TOOLS } = require('../config/constants');
const { sanitizeToolResult } = require('../utils/resultUtils');
const logger = require('../../../utils/logger');

/**
 * Save last command for retry functionality
 * @param {Object} agentResult - Agent execution result
 * @param {string} chatId - Chat ID
 * @param {string} userText - Original user text
 * @param {Object} input - Normalized input
 */
async function saveLastCommand(agentResult, chatId, userText, input) {
  // Get messageId from input (originalMessageId) or agentResult
  const messageId = input?.originalMessageId || agentResult?.originalMessageId;
  if (!messageId) {
    logger.warn('⚠️ [AGENT ROUTER] No messageId available, cannot save command to cache');
    return;
  }
  
  // CRITICAL: Handle multi-step commands - save the entire plan, not just the last tool
  if (agentResult.multiStep && agentResult.plan) {
    // Validate plan structure before saving
    const plan = agentResult.plan;
    if (!plan.steps || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      logger.warn('⚠️ [AGENT ROUTER] Multi-step plan has invalid steps structure, not saving for retry:', {
        hasPlan: !!plan,
        hasSteps: !!(plan && plan.steps),
        isArray: !!(plan && plan.steps && Array.isArray(plan.steps)),
        stepsLength: plan && plan.steps ? plan.steps.length : 0
      });
      return;
    }
    
    // Save multi-step plan for retry
    const commandMetadata = {
      tool: 'multi_step',
      isMultiStep: true,
      plan: plan, // Save the validated plan
      prompt: userText,
      stepsCompleted: agentResult.stepsCompleted || 0,
      totalSteps: agentResult.totalSteps || plan.steps.length || 0,
      failed: !agentResult.success,
      normalized: input,
      imageUrl: agentResult.imageUrl || null,
      videoUrl: agentResult.videoUrl || null,
      audioUrl: agentResult.audioUrl || null
    };
    
    await conversationManager.saveCommand(chatId, messageId, commandMetadata);
    logger.info(`💾 [AGENT ROUTER] Saved multi-step command for retry: ${plan.steps.length} steps (${agentResult.stepsCompleted || 0} completed)`, {
      stepTools: plan.steps.map(s => s.tool || s.action?.substring(0, 30) || 'unknown').join(', ')
    });
    return;
  }
  
  // Single-step command: Save the last persistable tool call
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
    logger.debug('ℹ️ [AGENT ROUTER] No eligible tool call to save as last command');
    return;
  }
  
  const primaryTool = commandToSave.tool;
  const sanitizedResult = sanitizeToolResult(toolResults[primaryTool]);
  const commandMetadata = {
    tool: primaryTool,
    isMultiStep: false,
    toolArgs: commandToSave.args || {},
    result: sanitizedResult || null,
    prompt: userText,
    failed: !commandToSave.success,  // Mark if this command failed
    normalized: input,
    imageUrl: sanitizedResult?.imageUrl || agentResult.imageUrl || null,
    videoUrl: sanitizedResult?.videoUrl || agentResult.videoUrl || null,
    audioUrl: sanitizedResult?.audioUrl || agentResult.audioUrl || null
  };
  
  await conversationManager.saveCommand(chatId, messageId, commandMetadata);
  logger.info(`💾 [AGENT ROUTER] Saved last command for retry: ${primaryTool} (success: ${commandToSave.success})`);
}

module.exports = {
  saveLastCommand
};

