/**
 * Gemini Service - Facade
 * 
 * This file maintains backward compatibility by re-exporting
 * everything from the modular gemini/ directory.
 * 
 * All actual functionality is in services/gemini/
 */

// Re-export everything from gemini module for backward compatibility
// eslint-disable-next-line @typescript-eslint/no-require-imports
const geminiModule = require('./gemini');

// Export all functions individually for TypeScript compatibility
export const generateTextResponse = geminiModule.generateTextResponse;
export const generateImage = geminiModule.generateImage;
export const generateImageWithText = geminiModule.generateImageWithText;
export const generateImageForWhatsApp = geminiModule.generateImageForWhatsApp;
export const editImage = geminiModule.editImage;
export const editImageWithText = geminiModule.editImageWithText;
export const editImageForWhatsApp = geminiModule.editImageForWhatsApp;
export const analyzeImage = geminiModule.analyzeImage;
export const analyzeImageWithText = geminiModule.analyzeImageWithText;
export const generateVideo = geminiModule.generateVideo;
export const generateVideoWithText = geminiModule.generateVideoWithText;
export const generateVideoWithImage = geminiModule.generateVideoWithImage;
export const getLocationInfo = geminiModule.getLocationInfo;
export const getLocationBounds = geminiModule.getLocationBounds;
export const generateMusic = geminiModule.generateMusic;
export const generateTTS = geminiModule.generateTTS;
export const generatePoll = geminiModule.generatePoll;

// Export everything else as default for backward compatibility
export default geminiModule;

