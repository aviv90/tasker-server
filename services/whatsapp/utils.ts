/**
 * WhatsApp Utility Functions
 * Helper functions for WhatsApp message processing
 */

// Import from other services for SSOT
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isLandLocation } = require('../locationService');

/**
 * Message structure for chat history
 */
interface Message {
  role: string;
  content: string;
}

/**
 * Clean agent response text from internal instructions and metadata
 * Removes **IMPORTANT:** instructions, trailing metadata, media placeholders
 * @param text - Text to clean
 * @returns Cleaned text
 */
export function cleanAgentText(text: string | null | undefined): string {
  if (!text || typeof text !== 'string') return text || '';

  return text
    .replace(/\[image\]/gi, '')
    .replace(/\[video\]/gi, '')
    .replace(/\[audio\]/gi, '')
    .replace(/\[תמונה\]/gi, '')
    .replace(/\[וידאו\]/gi, '')
    .replace(/\[אודיו\]/gi, '')
    // CRITICAL: Remove generic link placeholders (Video Link, Link, etc.)
    .replace(/\[Video Link\]/gi, '')
    .replace(/\[Audio Link\]/gi, '')
    .replace(/\[Image Link\]/gi, '')
    .replace(/\[Music Link\]/gi, '')
    .replace(/\[File Link\]/gi, '')
    .replace(/\[Link\]/gi, '')
    .replace(/\[קישור[^\]]*\]/gi, '') // Hebrew: [קישור...]
    .replace(/\[לינק[^\]]*\]/gi, '') // Hebrew: [לינק...]
    // CRITICAL: Remove [audioUrl: ...], [imageUrl: ...], [videoUrl: ...] patterns
    // These are added by Gemini when returning tool results and shouldn't be sent to users
    .replace(/\[audioUrl:[^\]]*\]?/gi, '') // Remove [audioUrl: ...]
    .replace(/\[imageUrl:[^\]]*\]?/gi, '') // Remove [imageUrl: ...]
    .replace(/\[videoUrl:[^\]]*\]?/gi, '') // Remove [videoUrl: ...]
    .replace(/audioUrl:\s*https?:\/\/[^\s\]]+/gi, '') // Remove audioUrl: URL without brackets
    .replace(/imageUrl:\s*https?:\/\/[^\s\]]+/gi, '') // Remove imageUrl: URL without brackets
    .replace(/videoUrl:\s*https?:\/\/[^\s\]]+/gi, '') // Remove videoUrl: URL without brackets
    // CRITICAL: Remove curly brace variants and truncated artifacts
    .replace(/\{imageUrl:[^}]*\}?/gi, '')
    .replace(/\{videoUrl:[^}]*\}?/gi, '')
    .replace(/\{audioUrl:[^}]*\}?/gi, '')
    .replace(/\{imageUrl:\s*["']?$/gi, '') // Truncated at end
    .replace(/\{videoUrl:\s*["']?$/gi, '') // Truncated at end
    .replace(/\{audioUrl:\s*["']?$/gi, '') // Truncated at end
    .replace(/imageUrl:\s*["']?$/gi, '') // Truncated key at end
    .replace(/videoUrl:\s*["']?$/gi, '') // Truncated key at end
    .replace(/https?:\/\/[^\s]+/gi, '') // Remove plain URLs
    .replace(/\*\*IMPORTANT:.*?\*\*/gs, '') // Remove **IMPORTANT:** instructions
    .replace(/\n\n\[.*$/gs, '') // Remove trailing metadata starting with "["
    .replace(/\n\[\s*$/g, '') // Remove orphan "[" at end with optional whitespace
    .replace(/^\[\s*\n/g, '') // Remove orphan "[" at start with optional whitespace
    .replace(/\n\[\s*\n/g, '\n') // Remove orphan "[" between lines
    .replace(/\s*\[\s*$/g, '') // Remove trailing orphan "[" with spaces
    .trim();
}

/**
 * Clean sensitive/large data from objects for logging
 * Removes base64 thumbnails and truncates long strings
 * @param obj - Object to clean
 * @returns Cleaned object
 */
export function cleanForLogging(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object' || obj === null) return obj;

  // Create a deep copy to avoid modifying the original
  const cleaned = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;

  function cleanObject(o: Record<string, unknown>): void {
    for (const key in o) {
      if (o[key] && typeof o[key] === 'object' && o[key] !== null) {
        cleanObject(o[key] as Record<string, unknown>);
      } else if (key === 'jpegThumbnail' || key === 'thumbnail') {
        // Replace base64 thumbnails with a short indicator
        if (typeof o[key] === 'string' && o[key].length > 100) {
          o[key] = `[base64 thumbnail: ${o[key].length} chars]`;
        }
      } else if (key === 'vcard' && typeof o[key] === 'string' && o[key].length > 200) {
        // Truncate long vCard fields (contact cards with base64 photos)
        o[key] = `[vCard: ${o[key].length} chars, starts with: ${o[key].substring(0, 100)}...]`;
      } else if ((key === 'downloadUrl' || key === 'url') && typeof o[key] === 'string' && o[key].length > 200) {
        // Truncate long URLs
        o[key] = `[URL: ${o[key].length} chars, starts with: ${o[key].substring(0, 80)}...]`;
      } else if (key === 'data' && typeof o[key] === 'string' && o[key].length > 200) {
        // Truncate long base64 data fields
        o[key] = `[base64 data: ${o[key].length} chars, starts with: ${o[key].substring(0, 50)}...]`;
      }
    }
  }

  cleanObject(cleaned);
  return cleaned;
}

// isLandLocation is now imported from services/locationService.js (SSOT)
export { isLandLocation };

/**
 * Format chat history for context
 * @param messages - Array of messages
 * @returns Formatted chat history
 */
export function formatChatHistoryForContext(messages: Message[] | null | undefined): string {
  if (!messages || messages.length === 0) return '';

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getRole } = require('../../config/messages');
  return messages.map(msg => {
    const role = getRole(msg.role);
    return `${role}: ${msg.content}`;
  }).join('\n');
}

// getAudioDuration moved to services/agent/utils/audioUtils.ts (SSOT)
// Import and re-export for backward compatibility
export { getAudioDuration } from '../agent/utils/audioUtils';

