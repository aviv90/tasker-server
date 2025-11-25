/**
 * Gemini Special Operations
 * 
 * Specialized operations: music parsing, TTS, polls, location services.
 * Refactored to use modular components (Phase 5.3)
 */

// Import modular components
// eslint-disable-next-line @typescript-eslint/no-require-imports
const musicParserModule = require('./special/music');
const musicParser = musicParserModule.default || musicParserModule;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ttsParserModule = require('./special/tts');
const ttsParser = ttsParserModule.default || ttsParserModule;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pollGeneratorModule = require('./special/polls');
const pollGenerator = pollGeneratorModule.default || pollGeneratorModule;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const locationServiceModule = require('./special/location');
const locationService = locationServiceModule.default || locationServiceModule;

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

