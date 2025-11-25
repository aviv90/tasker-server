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
import * as imageGeneration from './imageGeneration';
import * as videoGeneration from './videoGeneration';
import * as textOperations from './textOperations';
import * as specialOperations from './specialOperations';

// Re-export everything for backward compatibility
export default {
  ...imageGeneration,
  ...videoGeneration,
  ...textOperations,
  ...specialOperations
};
