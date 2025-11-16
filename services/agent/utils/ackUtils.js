/**
 * Ack Utilities - Agent acknowledgment message handling
 * 
 * Manages user-facing acknowledgment messages when tools are executed.
 * - Formats provider names consistently
 * - Handles single/multiple tool Acks
 * - Prevents duplicate Acks for tools that send their own
 * 
 * Extracted from agentService.js (Phase 4.2)
 */

const { getServices } = require('./serviceLoader');
const { formatProviderName, normalizeProviderKey, applyProviderToMessage } = require('./providerUtils');
const { TOOL_ACK_MESSAGES, VIDEO_PROVIDER_FALLBACK_ORDER, VIDEO_PROVIDER_DISPLAY_MAP } = require('../config/constants');

/**
 * Get ACK message for a specific tool and provider (SSOT for all ACKs)
 * @param {string} toolName - Tool name
 * @param {string} provider - Provider name (optional)
 * @returns {string} - ACK message
 */
function getToolAckMessage(toolName, provider = null) {
  // Get base message from constants
  let baseMessage = TOOL_ACK_MESSAGES[toolName] || 'מבצע פעולה... ⚙️';
  
  // Determine provider if not provided
  if (!provider) {
    if (toolName === 'create_image' || toolName === 'edit_image') {
      provider = 'gemini';
    } else if (toolName === 'create_video' || toolName === 'edit_video' || toolName === 'image_to_video') {
      provider = 'grok'; // kling is the default
    }
  }
  
  // Normalize and format provider name
  if (provider) {
    const isVideoTask = toolName === 'create_video' || toolName === 'image_to_video' || toolName === 'edit_video';
    let providerDisplayKey = provider;
    
    if (isVideoTask) {
      const normalizedKey = normalizeProviderKey(provider);
      if (normalizedKey && VIDEO_PROVIDER_DISPLAY_MAP[normalizedKey]) {
        providerDisplayKey = VIDEO_PROVIDER_DISPLAY_MAP[normalizedKey];
      }
    }
    
    const providerName = formatProviderName(providerDisplayKey);
    baseMessage = applyProviderToMessage(baseMessage, providerName);
  }
  
  return baseMessage;
}

/**
 * Send acknowledgment message to user based on tools being executed
 * @param {string} chatId - Chat ID
 * @param {Array} functionCalls - Array of function calls (with name and args)
 */
async function sendToolAckMessage(chatId, functionCalls) {
  if (!chatId || !functionCalls || functionCalls.length === 0) return;
  
  try {
    let ackMessage = '';
    
    // Helper to build Ack message for a single tool
    const buildSingleAck = (call) => {
      const toolName = call.name;
      
      // SKIP: These tools handle their own Acks internally or don't need ACK
      if (toolName === 'send_location' || 
          toolName === 'retry_with_different_provider' || 
          toolName === 'retry_last_command') {
        return '';
      }
      
      // Extract provider from args
      const providerRaw = call.args?.provider || call.args?.service;
      let provider = normalizeProviderKey(providerRaw);
      
      // Special handling for smart_execute_with_fallback
      if (!provider && toolName === 'smart_execute_with_fallback') {
        const providersTriedRaw = [];
        if (Array.isArray(call.args?.providers_tried)) {
          providersTriedRaw.push(...call.args.providers_tried);
        }
        if (call.args?.provider_tried) {
          providersTriedRaw.push(call.args.provider_tried);
        }
        const providersTried = providersTriedRaw.map(normalizeProviderKey).filter(Boolean);
        const availableProviders = VIDEO_PROVIDER_FALLBACK_ORDER.filter(p => !providersTried.includes(p));
        provider = availableProviders[0] || null;
      }
      
      // Use centralized ACK message function (SSOT)
      return getToolAckMessage(toolName, provider || providerRaw);
    };
    
    if (functionCalls.length === 1) {
      const singleAck = buildSingleAck(functionCalls[0]);
      if (!singleAck || !singleAck.trim()) {
        return;
      }
      ackMessage = singleAck;
    } else if (functionCalls.length === 2) {
      const acks = functionCalls
        .map(buildSingleAck)
        .filter(msg => msg && msg.trim());
      if (acks.length === 0) {
        return;
      }
      ackMessage = `מבצע:\n• ${acks.join('\n• ')}`;
    } else {
      // Multiple tools - generic message
      const acks = functionCalls
        .map(buildSingleAck)
        .filter(msg => msg && msg.trim());
      if (acks.length === 0) {
        return;
      }
      ackMessage = `מבצע ${acks.length} פעולות... ⚙️`;
    }
    
    if (!ackMessage || !ackMessage.trim()) {
      return;
    }
    
    console.log(`📢 [ACK] Sending acknowledgment: "${ackMessage}"`);
    const { greenApiService } = getServices();
    await greenApiService.sendTextMessage(chatId, ackMessage);
  } catch (error) {
    console.error('❌ [ACK] Failed to send acknowledgment:', error.message);
    // Don't throw - Ack failure shouldn't break the agent
  }
}

module.exports = {
  sendToolAckMessage,
  getToolAckMessage
};

