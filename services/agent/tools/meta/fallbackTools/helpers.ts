/**
 * Shared helpers for fallback tools
 */
import { getServices } from '../../../utils/serviceLoader';
import { formatProviderName, normalizeProviderKey } from '../../../utils/providerUtils';
import { VIDEO_PROVIDER_FALLBACK_ORDER, VIDEO_PROVIDER_DISPLAY_MAP, DEFAULT_IMAGE_PROVIDERS } from '../../../config/constants';
import { extractQuotedMessageId } from '../../../../../utils/messageHelpers';
import logger from '../../../../../utils/logger';

// Export these for use by other modules
export { formatProviderName, normalizeProviderKey };

type ToolContext = {
  chatId?: string;
  originalInput?: {
    originalMessageId?: string;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
};

/**
 * Send fallback Ack message
 */
export async function sendFallbackAck(context: ToolContext, message: string): Promise<void> {
  if (!context?.chatId) return;
  try {
    const { greenApiService } = getServices();
    const quotedMessageId = extractQuotedMessageId({ context } as { context: ToolContext });
    await greenApiService.sendTextMessage(context.chatId, message, quotedMessageId || undefined, 1000);
    logger.info(`📢 [Fallback Ack] Sent: "${message}"`);
  } catch (ackError) {
    logger.error('❌ Failed to send fallback Ack:', ackError as Error);
  }
}

/**
 * Send fallback error message
 */
export async function sendFallbackError(context: ToolContext, message: string): Promise<void> {
  if (!context?.chatId) return;
  try {
    const { greenApiService } = getServices();
    const quotedMessageId = extractQuotedMessageId({ context } as { context: ToolContext });
    await greenApiService.sendTextMessage(context.chatId, message, quotedMessageId || undefined, 1000);
    logger.info(`📢 [Fallback Error] Sent to user: "${message}"`);
  } catch (sendError) {
    logger.error('❌ Failed to send error to user:', sendError as Error);
  }
}

/**
 * Get provider order for fallback based on task type
 */
export function getProviderOrder(taskType: string, avoidProvider: string | null = null): string[] {
  if (taskType === 'image_edit') {
    // STRICT: Only Image Editing providers
    const validProviders = ['gemini', 'openai'];
    return validProviders.filter((p: string) => p !== avoidProvider);
  } else if (taskType === 'video' || taskType === 'video_creation' || taskType === 'image_to_video') {
    // STRICT: Only Video providers
    // We must ensure VIDEO_PROVIDER_FALLBACK_ORDER does not contain image-only providers
    return VIDEO_PROVIDER_FALLBACK_ORDER.filter((p: string) => p !== avoidProvider);
  } else {
    // Image creation
    // Image creation - use centralized constant (SSOT)
    return [...DEFAULT_IMAGE_PROVIDERS].filter((p: string) => p !== avoidProvider);
  }
}

/**
 * Get display provider name
 */
export function getDisplayProvider(provider: string): string {
  if (VIDEO_PROVIDER_DISPLAY_MAP[provider]) {
    return VIDEO_PROVIDER_DISPLAY_MAP[provider];
  }
  return provider;
}

/**
 * Normalize providers list
 */
export function normalizeProviders(
  providersTriedRaw?: string[] | null,
  provider_tried?: string | null
): string[] {
  const providersTriedRawList: string[] = [];
  if (Array.isArray(providersTriedRaw)) {
    providersTriedRawList.push(...providersTriedRaw);
  }
  if (provider_tried) {
    providersTriedRawList.push(provider_tried);
  }
  return providersTriedRawList
    .map(provider => (provider ? normalizeProviderKey(provider) : null))
    .filter((value): value is string => Boolean(value));
}

/**
 * Get next providers to try
 */
export function getNextProviders(
  providersTried: string[],
  providerOrder: string[] | readonly string[],
  lastTried: string | null = null
): string[] {
  const startIndex = lastTried ? providerOrder.indexOf(lastTried) : -1;
  const startIdx = startIndex === -1 ? null : startIndex;
  const providers: string[] = [];

  for (let i = 0; i < providerOrder.length; i++) {
    const index = startIdx === null ? i : (startIdx + 1 + i) % providerOrder.length;
    const candidate = providerOrder[index];
    if (!candidate) {
      continue;
    }
    if (!providersTried.includes(candidate) && !providers.includes(candidate)) {
      providers.push(candidate);
    }
  }

  return providers;
}
