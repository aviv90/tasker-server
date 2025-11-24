/**
 * OpenAI Service - Legacy Export
 * 
 * This file is maintained for backward compatibility.
 * All functions have been extracted to services/openai/ (Phase 5.3).
 * 
 * @deprecated Use services/openai/ directly for new code.
 */

// Re-export all functions from the new modular structure
// eslint-disable-next-line @typescript-eslint/no-require-imports
const openaiModule = require('./openai');

// Export everything for backward compatibility
export default openaiModule;

// Also export individual functions if needed
export const generateImage = openaiModule.generateImage;
export const generateVideo = openaiModule.generateVideo;
export const generateText = openaiModule.generateText;

