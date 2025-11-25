/**
 * Result Utility Functions (TypeScript)
 */

export function truncate(text: unknown, maxLength = 90): string {
  if (!text || typeof text !== 'string') return '';
  return text.length > maxLength ? `${text.substring(0, maxLength)}…` : text;
}

export function parseJSONSafe<T = unknown>(value: unknown): T | null {
  if (!value) return null;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch (_err) {
    return null;
  }
}

const ALLOWED_KEYS = [
  'success',
  'data',
  'error',
  'imageUrl',
  'imageCaption',
  'videoUrl',
  'audioUrl',
  'translation',
  'translatedText',
  'provider',
  'strategy_used',
  'poll',
  'latitude',
  'longitude',
  'locationInfo',
  'text',
  'prompt'
] as const;

type AllowedKey = (typeof ALLOWED_KEYS)[number];

export function sanitizeToolResult<T extends Record<string, unknown>>(result: T): Partial<T> {
  if (!result || typeof result !== 'object') return result;

  const sanitized: Partial<T> = {};
  for (const key of ALLOWED_KEYS) {
    if (result[key as AllowedKey] !== undefined) {
      (sanitized as Record<string, unknown>)[key] = result[key as AllowedKey];
    }
  }
  return sanitized;
}

interface LastCommand {
  tool?: string;
  args?: {
    toolArgs?: Record<string, unknown>;
    result?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export function summarizeLastCommand(lastCommand?: LastCommand, maxLength = 90): string {
  if (!lastCommand) return '';

  const { tool = '' } = lastCommand;
  const argsWrapper = lastCommand.args || {};
  const toolArgs = (argsWrapper.toolArgs || argsWrapper) as Record<string, unknown>;
  const result = (argsWrapper.result || {}) as Record<string, unknown>;

  const parts: string[] = [];
  parts.push(`כלי: ${tool}`);

  const prompt = toolArgs.prompt as string | undefined;
  const text = toolArgs.text as string | undefined;
  const targetLanguage = (toolArgs.target_language || toolArgs.language) as string | undefined;

  if (prompt) {
    parts.push(`פרומפט: ${truncate(prompt, maxLength)}`);
  } else if (text) {
    parts.push(`טקסט: ${truncate(text, maxLength)}`);
  }

  if (targetLanguage) {
    parts.push(`שפה: ${targetLanguage}`);
  }

  const translation = (result.translation || result.translatedText) as string | undefined;
  if (translation) {
    parts.push(`תרגום: ${truncate(translation, maxLength)}`);
  }

  if (result.imageUrl) parts.push('תמונה: ✅');
  if (result.videoUrl) parts.push('וידאו: ✅');
  if (result.audioUrl) parts.push('אודיו: ✅');

  const provider = (result.provider || toolArgs.provider) as string | undefined;
  if (provider) {
    parts.push(`ספק: ${provider}`);
  }

  return parts.join(' | ');
}

module.exports = {
  truncate,
  parseJSONSafe,
  sanitizeToolResult,
  summarizeLastCommand
};

