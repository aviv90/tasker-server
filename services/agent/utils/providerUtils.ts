import { VIDEO_PROVIDER_DISPLAY_MAP } from '../config/constants';

type ProviderKey = string | null | undefined;

/**
 * Helper function to format provider names nicely
 */
export function formatProviderName(provider?: string | null): string | null | undefined {
  if (!provider) return provider;
  const providerNames: Record<string, string> = {
    gemini: 'Gemini',
    openai: 'OpenAI',
    grok: 'Grok',
    veo3: 'Veo 3',
    'veo-3': 'Veo 3',
    veo: 'Veo 3',
    sora: 'Sora 2',
    'sora-2': 'Sora 2',
    sora2: 'Sora 2',
    'sora-pro': 'Sora 2 Pro',
    'sora-2-pro': 'Sora 2 Pro',
    kling: 'Kling',
    runway: 'Runway',
    suno: 'Suno'
  };
  return providerNames[provider.toLowerCase()] || provider;
}

/**
 * Normalize provider key to standard format
 */
export function normalizeProviderKey(provider: ProviderKey): string | null {
  if (!provider) return null;
  const key = String(provider).toLowerCase();
  const mapping: Record<string, string> = {
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
    sora2: 'openai',
    'sora-2-pro': 'openai',
    'sora-pro': 'openai',
    openai: 'openai'
  };
  return mapping[key] || key;
}

/**
 * Apply provider name to message (for ACK messages)
 */
export function applyProviderToMessage(message: string, providerName?: string | null): string {
  if (message.includes('__PROVIDER__')) {
    if (!providerName) {
      return message.replace(' עם __PROVIDER__', '').replace('עם __PROVIDER__ ', '');
    }
    return message.replace('__PROVIDER__', providerName);
  }
  if (providerName) {
    if (message.includes('...')) {
      return message.replace('...', ` עם ${providerName}...`).replace('  ', ' ');
    }
    return `${message} (${providerName})`;
  }
  return message;
}

/**
 * Map video provider key to display name if available
 */
export function mapVideoProviderDisplay(provider: string | null): string | null {
  if (!provider) return provider;
  const normalizedKey = normalizeProviderKey(provider);
  if (!normalizedKey) return provider;
  return VIDEO_PROVIDER_DISPLAY_MAP[normalizedKey] || provider;
}

