/**
 * WhatsApp Utility Functions
 * Helper functions for WhatsApp message processing
 */

// Import from other services for SSOT
const { isLandLocation } = require('../locationService');

/**
 * Clean agent response text from internal instructions and metadata
 * Removes **IMPORTANT:** instructions, trailing metadata, media placeholders
 * @param {string} text - Text to clean
 * @returns {string} - Cleaned text
 */
function cleanAgentText(text) {
  if (!text || typeof text !== 'string') return text;
  
  return text
    .replace(/\[image\]/gi, '')
    .replace(/\[video\]/gi, '')
    .replace(/\[audio\]/gi, '')
    .replace(/\[תמונה\]/gi, '')
    .replace(/\[וידאו\]/gi, '')
    .replace(/\[אודיו\]/gi, '')
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
 * @param {*} obj - Object to clean
 * @returns {*} - Cleaned object
 */
function cleanForLogging(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  // Create a deep copy to avoid modifying the original
  const cleaned = JSON.parse(JSON.stringify(obj));
  
  function cleanObject(o) {
    for (const key in o) {
      if (o[key] && typeof o[key] === 'object') {
        cleanObject(o[key]);
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

/**
 * Format chat history for context
 * @param {Array} messages - Array of messages
 * @returns {string} - Formatted chat history
 */
function formatChatHistoryForContext(messages) {
  if (!messages || messages.length === 0) return '';
  
  return messages.map(msg => {
    const role = msg.role === 'user' ? 'משתמש' : 'בוט';
    return `${role}: ${msg.content}`;
  }).join('\n');
}

// getAudioDuration moved to services/agent/utils/audioUtils.js (SSOT)
// Import and re-export for backward compatibility
const { getAudioDuration } = require('../agent/utils/audioUtils');

module.exports = {
  cleanAgentText,
  cleanForLogging,
  isLandLocation,
  formatChatHistoryForContext,
  getAudioDuration
};

