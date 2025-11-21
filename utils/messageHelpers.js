/**
 * Message Helper Utilities
 * 
 * Centralized helpers for message-related operations.
 * SSOT for common message patterns - eliminates code duplication (DRY).
 */

/**
 * Extract quoted message ID from various sources
 * @param {Object} options - Options object
 * @param {string} [options.originalMessageId] - Original message ID
 * @param {string} [options.quotedMessageId] - Quoted message ID
 * @param {Object} [options.context] - Context object with originalMessageId
 * @param {Object} [options.agentResult] - Agent result with originalMessageId
 * @param {Object} [options.normalized] - Normalized input with originalMessageId
 * @param {Object} [options.command] - Command object with originalMessageId
 * @param {Object} [options.webhookData] - Webhook data with idMessage
 * @returns {string|null} - Quoted message ID or null
 */
function extractQuotedMessageId(options = {}) {
  const {
    originalMessageId,
    quotedMessageId,
    context,
    agentResult,
    normalized,
    command,
    webhookData
  } = options;

  // Direct values take precedence
  if (quotedMessageId) return quotedMessageId;
  if (originalMessageId) return originalMessageId;

  // Try nested objects
  if (context?.originalInput?.originalMessageId) {
    return context.originalInput.originalMessageId;
  }
  if (agentResult?.originalMessageId) {
    return agentResult.originalMessageId;
  }
  if (normalized?.originalMessageId) {
    return normalized.originalMessageId;
  }
  if (command?.originalMessageId) {
    return command.originalMessageId;
  }
  if (webhookData?.idMessage) {
    return webhookData.idMessage;
  }
  if (context?.originalMessageId) {
    return context.originalMessageId;
  }

  return null;
}

module.exports = {
  extractQuotedMessageId
};

