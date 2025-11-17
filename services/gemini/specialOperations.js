/**
 * Gemini Special Operations
 * 
 * Specialized operations: music parsing, TTS, polls, location services.
 * Refactored to use modular components (Phase 5.3)
 */

// Import modular components
const musicParser = require('./special/music');
const ttsParser = require('./special/tts');
const pollGenerator = require('./special/polls');
const locationService = require('./special/location');

/**
 * Parse music request to detect video requirement
 */
async function parseMusicRequest(prompt) {
  return await musicParser.parseMusicRequest(prompt);
}

/**
 * Parse text-to-speech request to detect if translation is needed
 */
async function parseTextToSpeechRequest(prompt) {
  return await ttsParser.parseTextToSpeechRequest(prompt);
}

/**
 * Generate creative poll with optional rhyming
 */
async function generateCreativePoll(topic, withRhyme = true) {
  return await pollGenerator.generateCreativePoll(topic, withRhyme);
}

/**
 * Get location information using Google Maps grounding
 */
async function getLocationInfo(latitude, longitude) {
  return await locationService.getLocationInfo(latitude, longitude);
}

/**
 * Get bounds for a city/location name using Google Maps Geocoding
 */
async function getLocationBounds(locationName) {
  return await locationService.getLocationBounds(locationName);
}

module.exports = {
  parseMusicRequest,
  parseTextToSpeechRequest,
  generateCreativePoll,
  getLocationInfo,
  getLocationBounds
};
