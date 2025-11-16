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
      if (toolName === 'send_location') {
        return '';
      }
      // CRITICAL: Never expose tool names to user - use generic message if undefined
      let baseMessage = TOOL_ACK_MESSAGES[toolName] || 'מבצע פעולה... ⚙️';
      
      // Check if this tool uses a provider (direct or nested)
      const providerRaw = call.args?.provider || call.args?.service;
      let provider = normalizeProviderKey(providerRaw);
      
      // Default providers for creation/edit tools if not specified
      if (!provider) {
        if (toolName === 'create_image' || toolName === 'edit_image') {
          provider = 'gemini';
        } else if (toolName === 'create_video' || toolName === 'edit_video') {
          provider = 'grok'; // kling is the default for video
        } else if (toolName === 'image_to_video') {
          provider = 'grok'; // kling
        }
      }
      
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
      
      // SKIP: retry_with_different_provider handles its own Acks internally
      // Sending Ack here would duplicate the Acks sent by the tool itself
      if (toolName === 'retry_with_different_provider') {
        return ''; // Don't send any Ack - let the tool handle it
      }
      
      let providerDisplayKey = providerRaw || provider;
      const isVideoTask = call.args?.task_type === 'video_creation' 
                       || call.args?.task_type === 'video'
                       || toolName === 'create_video'
                       || toolName === 'retry_with_different_provider' && call.args?.task_type === 'video';
      if (isVideoTask) {
        const normalizedKey = normalizeProviderKey(providerDisplayKey);
        if (normalizedKey && VIDEO_PROVIDER_DISPLAY_MAP[normalizedKey]) {
          providerDisplayKey = VIDEO_PROVIDER_DISPLAY_MAP[normalizedKey];
        } else if (!providerRaw && provider && VIDEO_PROVIDER_DISPLAY_MAP[provider]) {
          providerDisplayKey = VIDEO_PROVIDER_DISPLAY_MAP[provider];
        }
      }
      
      const providerName = providerDisplayKey ? formatProviderName(providerDisplayKey) : null;
      baseMessage = applyProviderToMessage(baseMessage, providerName);
      
      return baseMessage;
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
  sendToolAckMessage
};

