/**
 * Shared helpers for fallback tools
 */
const { getServices } = require('../../../../utils/serviceLoader');
const { formatProviderName, normalizeProviderKey } = require('../../../../utils/providerUtils');
const { VIDEO_PROVIDER_FALLBACK_ORDER, VIDEO_PROVIDER_DISPLAY_MAP } = require('../../../../config/constants');

/**
 * Send fallback Ack message
 */
async function sendFallbackAck(context, message) {
  try {
    const { greenApiService } = getServices();
    const quotedMessageId = context.originalInput?.originalMessageId || null;
    await greenApiService.sendTextMessage(context.chatId, message, quotedMessageId);
    console.log(`📢 [Fallback Ack] Sent: "${message}"`);
  } catch (ackError) {
    console.error('❌ Failed to send fallback Ack:', ackError);
  }
}

/**
 * Send fallback error message
 */
async function sendFallbackError(context, message) {
  try {
    const { greenApiService } = getServices();
    const quotedMessageId = context.originalInput?.originalMessageId || null;
    await greenApiService.sendTextMessage(context.chatId, message, quotedMessageId);
    console.log(`📢 [Fallback Error] Sent to user: "${message}"`);
  } catch (sendError) {
    console.error('❌ Failed to send error to user:', sendError);
  }
}

/**
 * Get provider order for fallback based on task type
 */
function getProviderOrder(taskType, avoidProvider = null) {
  if (taskType === 'image_edit') {
    return ['gemini', 'openai'].filter(p => p !== avoidProvider);
  } else if (taskType === 'video' || taskType === 'video_creation') {
    return VIDEO_PROVIDER_FALLBACK_ORDER.filter(p => p !== avoidProvider);
  } else {
    // Image creation
    return ['gemini', 'openai', 'grok'].filter(p => p !== avoidProvider);
  }
}

/**
 * Get display provider name
 */
function getDisplayProvider(provider) {
  if (VIDEO_PROVIDER_DISPLAY_MAP[provider]) {
    return VIDEO_PROVIDER_DISPLAY_MAP[provider];
  }
  return provider;
}

/**
 * Normalize providers list
 */
function normalizeProviders(providersTriedRaw, provider_tried) {
  const providersTriedRawList = [];
  if (Array.isArray(providersTriedRaw)) {
    providersTriedRawList.push(...providersTriedRaw);
  }
  if (provider_tried) {
    providersTriedRawList.push(provider_tried);
  }
  return providersTriedRawList.map(normalizeProviderKey).filter(Boolean);
}

/**
 * Get next providers to try
 */
function getNextProviders(providersTried, providerOrder, lastTried = null) {
  const startIndex = lastTried ? providerOrder.indexOf(lastTried) : -1;
  const startIdx = startIndex === -1 ? null : startIndex;
  const providers = [];

  for (let i = 0; i < providerOrder.length; i++) {
    const index = startIdx === null ? i : (startIdx + 1 + i) % providerOrder.length;
    const candidate = providerOrder[index];
    if (!providersTried.includes(candidate) && !providers.includes(candidate)) {
      providers.push(candidate);
    }
  }

  return providers;
}

module.exports = {
  sendFallbackAck,
  sendFallbackError,
  getProviderOrder,
  getDisplayProvider,
  normalizeProviders,
  getNextProviders,
  formatProviderName,
  normalizeProviderKey
};

