/**
 * WhatsApp Utility Functions
 * Helper functions for WhatsApp message processing
 */

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

/**
 * Check if a location description indicates land (not open water)
 * @param {string} description - Location description from Gemini
 * @returns {boolean} - true if land, false if open water
 */
function isLandLocation(description) {
  const descLower = description.toLowerCase();
  
  // POSITIVE INDICATORS: If any found, immediately accept as land
  const landIndicators = [
    'עיר', 'כפר', 'ישוב', 'מדינה', 'רחוב', 'שכונה', 'אזור', 'מחוז', 'מדבר', 'הר', 'עמק', 'יער',
    'city', 'town', 'village', 'country', 'street', 'district', 'region', 'province', 
    'desert', 'mountain', 'valley', 'forest', 'park', 'road', 'highway', 'building',
    'neighborhood', 'settlement', 'capital', 'state', 'county', 'rural', 'urban', 'population'
  ];
  
  const hasLandIndicator = landIndicators.some(indicator => descLower.includes(indicator));
  
  if (hasLandIndicator) {
    return true; // Strong land indicator - accept!
  }
  
  // NEGATIVE INDICATORS: Only reject if OPEN WATER (not coastal areas)
  const openWaterKeywords = [
    'אוקיינוס', 'באוקיינוס', 'באמצע האוקיינוס', 'באמצע הים', 'בלב הים',
    'in the ocean', 'in the middle of the ocean', 'in the middle of the sea',
    'open water', 'open ocean', 'deep water', 'deep ocean', 'open sea',
    'atlantic ocean', 'pacific ocean', 'indian ocean', 'arctic ocean',
    'מים פתוחים', 'מים עמוקים', 'אין יבשה', 'no land'
  ];
  
  const isOpenWater = openWaterKeywords.some(keyword => descLower.includes(keyword));
  
  return !isOpenWater; // Accept unless it's open water
}

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

/**
 * Get audio duration from buffer using ffprobe
 * @param {Buffer} audioBuffer - Audio file buffer
 * @returns {Promise<number>} - Duration in seconds
 */
async function getAudioDuration(audioBuffer) {
  const { promisify } = require('util');
  const { exec } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const execAsync = promisify(exec);
  
  const tempFile = path.join(os.tmpdir(), `audio_${Date.now()}.ogg`);
  
  try {
    // Write buffer to temp file
    fs.writeFileSync(tempFile, audioBuffer);
    
    // Use ffprobe to get duration
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tempFile}"`
    );
    
    const duration = parseFloat(stdout.trim());
    console.log(`🎤 Audio duration: ${duration.toFixed(2)} seconds`);
    
    // Clean up temp file
    fs.unlinkSync(tempFile);
    
    return duration;
  } catch (error) {
    console.error('❌ Error getting audio duration:', error.message);
    // Clean up temp file on error
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
    return 0;
  }
}

module.exports = {
  cleanAgentText,
  cleanForLogging,
  isLandLocation,
  formatChatHistoryForContext,
  getAudioDuration
};

