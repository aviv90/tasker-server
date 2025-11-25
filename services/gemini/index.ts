/**
 * Gemini Service - Main Entry Point
 * 
 * This file serves as the central export for all Gemini functionality.
 * Now organized into domain-specific modules (Phase 4.5):
 * - imageGeneration: Image creation, editing, analysis
 * - videoGeneration: Video creation, editing, analysis
 * - textOperations: Text generation, chat, translation
 * - specialOperations: Music parsing, TTS, polls, location
 */

// Import all functions from modular services
// eslint-disable-next-line @typescript-eslint/no-require-imports
const imageGeneration = require('./imageGeneration');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const videoGeneration = require('./videoGeneration');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const textOperations = require('./textOperations');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const specialOperations = require('./specialOperations');

// Re-export everything for backward compatibility
export default {
  ...imageGeneration,
  ...videoGeneration,
  ...textOperations,
  ...specialOperations
};

