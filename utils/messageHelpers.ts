/**
 * Message Helper Utilities
 * 
 * Centralized helpers for message-related operations.
 * SSOT for common message patterns - eliminates code duplication (DRY).
 */

/**
 * Options for extracting quoted message ID
 */
export interface ExtractQuotedMessageIdOptions {
  originalMessageId?: string;
  quotedMessageId?: string;
  context?: {
    originalInput?: {
      originalMessageId?: string;
    };
    originalMessageId?: string;
  };
  agentResult?: {
    originalMessageId?: string;
  };
  normalized?: {
    originalMessageId?: string;
  };
  command?: {
    originalMessageId?: string;
  };
  webhookData?: {
    idMessage?: string;
  };
}

/**
 * Extract quoted message ID from various sources
 * @param options - Options object with various potential sources
 * @returns Quoted message ID or null
 */
export function extractQuotedMessageId(options: ExtractQuotedMessageIdOptions = {}): string | null {
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

