/**
 * Ack Utilities - Agent acknowledgment message handling (TypeScript)
 */

import { getServices } from './serviceLoader';
import {
  formatProviderName,
  normalizeProviderKey,
  applyProviderToMessage,
  mapVideoProviderDisplay
} from './providerUtils';
import { TOOL_ACK_MESSAGES, VIDEO_PROVIDER_FALLBACK_ORDER } from '../config/constants';
import logger from '../../../utils/logger';

type ProviderKey = string | null | undefined;

export interface FunctionCall {
  name: string;
  args?: Record<string, unknown>;
}

/**
 * Get ACK message for a specific tool and provider (SSOT for all ACKs)
 */
export function getToolAckMessage(toolName: string, provider: ProviderKey = null): string {
  let baseMessage = TOOL_ACK_MESSAGES[toolName] || 'מבצע פעולה... ⚙️';

  // Determine provider if not provided
  if (!provider) {
    if (toolName === 'create_image' || toolName === 'edit_image') {
      provider = 'gemini';
    } else if (toolName === 'create_video' || toolName === 'edit_video' || toolName === 'image_to_video') {
      provider = 'grok';
    }
  }

  if (provider) {
    const isVideoTask =
      toolName === 'create_video' || toolName === 'image_to_video' || toolName === 'edit_video';
    let providerDisplayKey = provider;

    if (isVideoTask) {
      const mapped = mapVideoProviderDisplay(provider);
      if (mapped) {
        providerDisplayKey = mapped;
      }
    }

    const providerName = formatProviderName(providerDisplayKey);
    baseMessage = applyProviderToMessage(baseMessage, providerName || providerDisplayKey);
  }

  return baseMessage;
}

/**
 * Options for sending ACK messages
 */
export interface AckOptions {
  quotedMessageId?: string | null;
  skipToolsAck?: string[]; // Tools to skip ACK for (e.g., transcribe_audio when audio already transcribed)
}

/**
 * Send acknowledgment message to user based on tools being executed
 */
export async function sendToolAckMessage(
  chatId: string | null | undefined,
  functionCalls: FunctionCall[],
  quotedMessageIdOrOptions: string | null | AckOptions = null
): Promise<void> {
  if (!chatId || !functionCalls || functionCalls.length === 0) return;

  // Handle both old signature (quotedMessageId) and new signature (options)
  let quotedMessageId: string | null = null;
  let skipToolsAck: string[] = [];

  if (typeof quotedMessageIdOrOptions === 'string' || quotedMessageIdOrOptions === null) {
    quotedMessageId = quotedMessageIdOrOptions;
  } else if (quotedMessageIdOrOptions) {
    quotedMessageId = quotedMessageIdOrOptions.quotedMessageId || null;
    skipToolsAck = quotedMessageIdOrOptions.skipToolsAck || [];
  }

  // Filter out tools that should be skipped
  if (skipToolsAck.length > 0) {
    functionCalls = functionCalls.filter(call => !skipToolsAck.includes(call.name));
    if (functionCalls.length === 0) {
      logger.debug(`⏭️ [ACK] All tools filtered by skipToolsAck - no ACK needed`);
      return;
    }
  }

  try {
    let ackMessage = '';

    const buildSingleAck = (call: FunctionCall): string => {
      const toolName = call.name;

      if (toolName === 'send_location') {
        return '';
      }

      const args = call.args || {};
      const providerRaw = (args.provider || args.service) as ProviderKey;
      let provider = normalizeProviderKey(providerRaw);

      if (!provider && toolName === 'smart_execute_with_fallback') {
        const providersTriedRaw: ProviderKey[] = [];
        if (Array.isArray(args.providers_tried)) {
          providersTriedRaw.push(...(args.providers_tried as ProviderKey[]));
        }
        if (args.provider_tried) {
          providersTriedRaw.push(args.provider_tried as ProviderKey);
        }
        const providersTried = providersTriedRaw.map(normalizeProviderKey).filter(Boolean);
        const availableProviders = VIDEO_PROVIDER_FALLBACK_ORDER.filter(
          (p) => !providersTried.includes(p)
        );
        provider = availableProviders[0] || null;
      }

      return getToolAckMessage(toolName, provider || providerRaw);
    };

    // Calculate acks list
    const acks = functionCalls.map(buildSingleAck).filter((msg) => msg && msg.trim());

    if (acks.length === 0) return;

    // For 2 tools, show both (simple format, no "מבצע:")
    if (acks.length === 2) {
      ackMessage = `${acks[0] || ''} ${acks[1] || ''}`.trim();
    } else if (acks.length === 1) {
      // Only one tool after filtering - send it directly
      ackMessage = acks[0] || '';
    } else {
      // For 3+ tools, show count (but still no "מבצע:" prefix for single-step)
      ackMessage = `${acks.length} פעולות... ⚙️`;
    }

    if (!ackMessage.trim()) return;

    logger.debug(`📢 [ACK] Sending acknowledgment: "${ackMessage}"`);
    const { greenApiService } = getServices();
    await greenApiService.sendTextMessage(chatId, ackMessage, quotedMessageId, 1000);
  } catch (error) {
    const err = error as Error;
    logger.error('❌ [ACK] Failed to send acknowledgment:', { error: err.message, stack: err.stack });
    // Ack failure should not break the agent
  }
}
