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
const imageGenerationModule = require('./imageGeneration');
const imageGeneration = imageGenerationModule.default || imageGenerationModule;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const videoGenerationModule = require('./videoGeneration');
const videoGeneration = videoGenerationModule.default || videoGenerationModule;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const textOperationsModule = require('./textOperations');
const textOperations = textOperationsModule.default || textOperationsModule;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const specialOperationsModule = require('./specialOperations');
const specialOperations = specialOperationsModule.default || specialOperationsModule;

// Re-export everything for backward compatibility
export default {
  ...imageGeneration,
  ...videoGeneration,
  ...textOperations,
  ...specialOperations
};

