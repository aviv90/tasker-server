/**
 * Gemini Video Generation & Analysis
 * 
 * Video creation, editing, and analysis using Gemini Veo.
 * Refactored to use modular components (Phase 5.3)
 */

// Import modular components
const videoAnalysis = require('./video/analysis');
const veoGeneration = require('./video/veoGeneration');
const whatsappVideoGeneration = require('./video/whatsapp');

/**
 * Analyze video with text prompt
 */
async function analyzeVideoWithText(prompt, videoBuffer) {
  return await videoAnalysis.analyzeVideoWithText(prompt, videoBuffer);
}

/**
 * Generate video from text prompt
 */
async function generateVideoWithText(prompt) {
  return await veoGeneration.generateVideoWithText(prompt);
}

/**
 * Generate video from image and text prompt
 */
async function generateVideoWithImage(prompt, imageBuffer) {
  return await veoGeneration.generateVideoWithImage(prompt, imageBuffer);
}

/**
 * Generate video for WhatsApp from text prompt
 */
async function generateVideoForWhatsApp(prompt, req = null) {
  return await whatsappVideoGeneration.generateVideoForWhatsApp(prompt, req);
}

/**
 * Generate video for WhatsApp from image and text prompt
 */
async function generateVideoFromImageForWhatsApp(prompt, imageBuffer, req = null) {
  return await whatsappVideoGeneration.generateVideoFromImageForWhatsApp(prompt, imageBuffer, req);
}

module.exports = {
  analyzeVideoWithText,
  generateVideoWithText,
  generateVideoWithImage,
  generateVideoForWhatsApp,
  generateVideoFromImageForWhatsApp
};
