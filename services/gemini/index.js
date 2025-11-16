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
const imageGeneration = require('./imageGeneration');
const videoGeneration = require('./videoGeneration');
const textOperations = require('./textOperations');
const specialOperations = require('./specialOperations');

// Re-export everything for backward compatibility
module.exports = {
  ...imageGeneration,
  ...videoGeneration,
  ...textOperations,
  ...specialOperations
};

