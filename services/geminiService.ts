/**
 * Gemini Service - Facade
 * 
 * This file maintains backward compatibility by re-exporting
 * everything from the modular gemini/ directory.
 * 
 * All actual functionality is in services/gemini/
 */

// Re-export everything from gemini module for backward compatibility
import geminiModule from './gemini';

// Export all functions individually for TypeScript compatibility
export const generateTextResponse = geminiModule.generateTextResponse;
export const generateImageWithText = geminiModule.generateImageWithText;
export const generateImageForWhatsApp = geminiModule.generateImageForWhatsApp;
export const editImageWithText = geminiModule.editImageWithText;
export const editImageForWhatsApp = geminiModule.editImageForWhatsApp;
export const analyzeImageWithText = geminiModule.analyzeImageWithText;
export const generateVideoWithText = geminiModule.generateVideoWithText;
export const generateVideoWithImage = geminiModule.generateVideoWithImage;
export const generateVideoForWhatsApp = geminiModule.generateVideoForWhatsApp;
export const generateVideoFromImageForWhatsApp = geminiModule.generateVideoFromImageForWhatsApp;
export const analyzeVideoWithText = geminiModule.analyzeVideoWithText;
export const generateChatSummary = geminiModule.generateChatSummary;
export const translateText = geminiModule.translateText;
export const parseMusicRequest = geminiModule.parseMusicRequest;
export const parseTextToSpeechRequest = geminiModule.parseTextToSpeechRequest;
export const generateCreativePoll = geminiModule.generateCreativePoll;
export const getLocationInfo = geminiModule.getLocationInfo;
export const getLocationBounds = geminiModule.getLocationBounds;
export const generatePoll = geminiModule.generateCreativePoll;

// Legacy aliases for backward compatibility
// Use casting to any to avoid TS errors if properties don't exist on the imported module type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gm = geminiModule as any;
export const generateImage = gm.generateImage || geminiModule.generateImageWithText;
export const generateVideo = gm.generateVideo || geminiModule.generateVideoWithText;
export const generateMusic = gm.generateMusic; // Might be undefined, which is fine if checked at runtime
export const generateTTS = gm.generateTTS;

// Export everything else as default for backward compatibility
export default geminiModule;

// Ensure CommonJS compatibility for existing require() calls
module.exports = geminiModule;
module.exports.generateTextResponse = generateTextResponse;
module.exports.generateImageWithText = generateImageWithText;
module.exports.generateImageForWhatsApp = generateImageForWhatsApp;
module.exports.editImageWithText = editImageWithText;
module.exports.editImageForWhatsApp = editImageForWhatsApp;
module.exports.analyzeImageWithText = analyzeImageWithText;
module.exports.generateVideoWithText = generateVideoWithText;
module.exports.generateVideoWithImage = generateVideoWithImage;
module.exports.generateVideoForWhatsApp = generateVideoForWhatsApp;
module.exports.generateVideoFromImageForWhatsApp = generateVideoFromImageForWhatsApp;
module.exports.analyzeVideoWithText = analyzeVideoWithText;
module.exports.generateChatSummary = generateChatSummary;
module.exports.translateText = translateText;
module.exports.parseMusicRequest = parseMusicRequest;
module.exports.parseTextToSpeechRequest = parseTextToSpeechRequest;
module.exports.generateCreativePoll = generateCreativePoll;
module.exports.getLocationInfo = getLocationInfo;
module.exports.getLocationBounds = getLocationBounds;
module.exports.generatePoll = generatePoll;
module.exports.generateImage = generateImage;
module.exports.generateVideo = generateVideo;
module.exports.generateMusic = generateMusic;
module.exports.generateTTS = generateTTS;
