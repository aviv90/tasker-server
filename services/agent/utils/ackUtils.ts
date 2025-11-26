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
 * Send acknowledgment message to user based on tools being executed
 */
export async function sendToolAckMessage(
  chatId: string | null | undefined,
  functionCalls: FunctionCall[],
  quotedMessageId: string | null = null
): Promise<void> {
  if (!chatId || !functionCalls || functionCalls.length === 0) return;

  try {
    let ackMessage = '';

    const buildSingleAck = (call: FunctionCall): string => {
      const toolName = call.name;

      if (
        toolName === 'send_location' ||
        toolName === 'retry_with_different_provider' ||
        toolName === 'retry_last_command' ||
        toolName === 'smart_execute_with_fallback'
      ) {
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

    if (functionCalls.length === 1) {
      const [firstCall] = functionCalls;
      if (!firstCall) return;
      const singleAck = buildSingleAck(firstCall);
      if (!singleAck?.trim()) return;
      ackMessage = singleAck;
    } else if (functionCalls.length === 2) {
      const acks = functionCalls.map(buildSingleAck).filter((msg) => msg && msg.trim());
      if (acks.length === 0) return;
      ackMessage = `מבצע:\n• ${acks.join('\n• ')}`;
    } else {
      const acks = functionCalls.map(buildSingleAck).filter((msg) => msg && msg.trim());
      if (acks.length === 0) return;
      ackMessage = `מבצע ${acks.length} פעולות... ⚙️`;
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

module.exports = {
  sendToolAckMessage,
  getToolAckMessage
};

