/**
 * Result Utility Functions
 * Helper functions for sanitizing and processing tool results
 */

/**
 * Truncate text to max length
 */
function truncate(text, maxLength = 90) {
  if (!text || typeof text !== 'string') return '';
  return text.length > maxLength ? `${text.substring(0, maxLength)}…` : text;
}

/**
 * Parse JSON safely
 */
function parseJSONSafe(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return null;
  }
}

/**
 * Sanitize tool result to only include allowed keys
 */
function sanitizeToolResult(result) {
  if (!result || typeof result !== 'object') return result;
  const allowedKeys = [
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
  ];
  return allowedKeys.reduce((acc, key) => {
    if (result[key] !== undefined) {
      acc[key] = result[key];
    }
    return acc;
  }, {});
}

/**
 * Summarize last command for context
 */
function summarizeLastCommand(lastCommand, maxLength = 90) {
  if (!lastCommand) return '';
  const { tool } = lastCommand;
  const argsWrapper = lastCommand.args || {};
  const toolArgs = argsWrapper.toolArgs || argsWrapper;
  const result = argsWrapper.result || {};
  
  const parts = [`כלי: ${tool}`];
  
  if (toolArgs.prompt) {
    parts.push(`פרומפט: ${truncate(toolArgs.prompt, maxLength)}`);
  } else if (toolArgs.text) {
    parts.push(`טקסט: ${truncate(toolArgs.text, maxLength)}`);
  }
  
  if (toolArgs.target_language || toolArgs.language) {
    parts.push(`שפה: ${toolArgs.target_language || toolArgs.language}`);
  }
  
  if (result.translation || result.translatedText) {
    parts.push(`תרגום: ${truncate(result.translation || result.translatedText, maxLength)}`);
  }
  
  if (result.imageUrl) {
    parts.push('תמונה: ✅');
  }
  if (result.videoUrl) {
    parts.push('וידאו: ✅');
  }
  if (result.audioUrl) {
    parts.push('אודיו: ✅');
  }
  if (result.provider || toolArgs.provider) {
    parts.push(`ספק: ${result.provider || toolArgs.provider}`);
  }
  
  return parts.join(' | ');
}

module.exports = {
  truncate,
  parseJSONSafe,
  sanitizeToolResult,
  summarizeLastCommand
};

