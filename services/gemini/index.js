/**
 * Gemini Service - Main Entry Point
 * 
 * This file serves as the central export for all Gemini functionality.
 * It imports from the core module and utility modules.
 * 
 * Future refactoring: Split core.js into domain-specific modules
 * (imageGeneration, videoGeneration, textGeneration, etc.)
 */

// Import all functions from core
const core = require('./core');

// Re-export everything for backward compatibility
module.exports = {
  ...core
};

