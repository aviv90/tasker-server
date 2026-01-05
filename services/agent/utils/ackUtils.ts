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
  args?: object;
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
    } else if (toolName === 'create_video' || toolName === 'image_to_video') {
      provider = 'kling';
    } else if (toolName === 'edit_video') {
      provider = 'runway';
    }
  }

  if (provider) {
    // Check if it's a video task OR if the provider exists in video map
    // This catches generic tools like 'retry_with_different_provider' where toolName is generic but provider is video-specific
    const isVideoTask =
      toolName === 'create_video' || toolName === 'image_to_video' || toolName === 'edit_video';

    let providerDisplayKey = provider;

    // Try mapping if it's a video task OR if the provider key is known in video map
    if (isVideoTask || mapVideoProviderDisplay(provider) !== provider) {
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


    const buildSingleAck = (call: FunctionCall): string => {
      const toolName = call.name;

      // Skip tools that handle their own ACKs (to avoid double notifications)
      if (
        toolName === 'retry_last_command' ||
        toolName === 'smart_execute_with_fallback' ||
        toolName === 'send_location'
      ) {
        return '';
      }



      const args = (call.args || {}) as Record<string, unknown>;
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

    // Calculate acks list and deduplicate (same tool called multiple times = one ACK)
    const acksRaw = functionCalls.map(buildSingleAck).filter((msg) => msg && msg.trim());
    const acks = [...new Set(acksRaw)]; // Remove duplicates

    if (acks.length === 0) return;

    // Send each unique ACK as a separate message
    if (acks.length > 0) {
      const { greenApiService } = getServices();

      // If we have multiple acks, send them sequentially
      for (const msg of acks) {
        if (msg && msg.trim()) {
          logger.debug(`📢 [ACK] Sending acknowledgment: "${msg}"`);
          await greenApiService.sendTextMessage(chatId, msg, quotedMessageId, 1000); // Green API minimum is 1000ms
        }
      }
    }
  } catch (error) {
    const err = error as Error;
    logger.error('❌ [ACK] Failed to send acknowledgment:', { error: err.message, stack: err.stack });
    // Ack failure should not break the agent
  }
}
