/**
 * Gemini Special Operations
 * 
 * Specialized operations: music parsing, TTS, polls, location services.
 * Refactored to use modular components (Phase 5.3)
 */

// Import modular components
// eslint-disable-next-line @typescript-eslint/no-require-imports
const musicParser = require('./special/music');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ttsParser = require('./special/tts');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pollGenerator = require('./special/polls');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const locationService = require('./special/location');

/**
 * Parse music request to detect video requirement
 */
export async function parseMusicRequest(prompt: string): Promise<unknown> {
  return await musicParser.parseMusicRequest(prompt);
}

/**
 * Parse text-to-speech request to detect if translation is needed
 */
export async function parseTextToSpeechRequest(prompt: string): Promise<unknown> {
  return await ttsParser.parseTextToSpeechRequest(prompt);
}

/**
 * Generate creative poll with optional rhyming
 */
export async function generateCreativePoll(topic: string, withRhyme = true): Promise<unknown> {
  return await pollGenerator.generateCreativePoll(topic, withRhyme);
}

/**
 * Get location information using Google Maps grounding
 */
export async function getLocationInfo(latitude: number, longitude: number): Promise<unknown> {
  return await locationService.getLocationInfo(latitude, longitude);
}

/**
 * Get bounds for a city/location name using Google Maps Geocoding
 */
export async function getLocationBounds(locationName: string): Promise<unknown> {
  return await locationService.getLocationBounds(locationName);
}

