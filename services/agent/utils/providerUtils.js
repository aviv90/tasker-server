/**
 * Provider Utility Functions
 * Helper functions for provider name formatting and normalization
 */

const { VIDEO_PROVIDER_DISPLAY_MAP } = require('../config/constants');

/**
 * Helper function to format provider names nicely
 */
function formatProviderName(provider) {
  const providerNames = {
    'gemini': 'Gemini',
    'openai': 'OpenAI',
    'grok': 'Grok',
    'veo3': 'Veo 3',
    'veo-3': 'Veo 3',
    'veo': 'Veo 3',
    'sora': 'Sora 2',
    'sora-2': 'Sora 2',
    'sora2': 'Sora 2',
    'sora-pro': 'Sora 2 Pro',
    'sora-2-pro': 'Sora 2 Pro',
    'kling': 'Kling',
    'runway': 'Runway',
    'suno': 'Suno'
  };
  return providerNames[provider?.toLowerCase()] || provider;
}

/**
 * Normalize provider key to standard format
 */
function normalizeProviderKey(provider) {
  if (!provider) return null;
  const key = String(provider).toLowerCase();
  const mapping = {
    kling: 'grok',
    'kling-text-to-video': 'grok',
    grok: 'grok',
    veo3: 'gemini',
    veo: 'gemini',
    gemini: 'gemini',
    google: 'gemini',
    'google-veo3': 'gemini',
    sora: 'openai',
    'sora-2': 'openai',
    'sora2': 'openai',
    'sora-2-pro': 'openai',
    'sora-pro': 'openai',
    openai: 'openai'
  };
  return mapping[key] || key;
}

/**
 * Apply provider name to message (for ACK messages)
 */
function applyProviderToMessage(message, providerName) {
  if (message.includes('__PROVIDER__')) {
    return message.replace('__PROVIDER__', providerName || 'ספק אחר');
  }
  if (providerName) {
    if (message.includes('...')) {
      return message.replace('...', ` עם ${providerName}...`).replace('  ', ' ');
    }
    return `${message} (${providerName})`;
  }
  return message;
}

module.exports = {
  formatProviderName,
  normalizeProviderKey,
  applyProviderToMessage
};

