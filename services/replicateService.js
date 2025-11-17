/**
 * Replicate Service
 * 
 * Video generation using Replicate (Kling, Veo 3, RunwayML).
 * Refactored to use modular components (Phase 5.3)
 */

// Import modular components
const replicateGeneration = require('./replicate/generation');
const replicateWhatsApp = require('./replicate/whatsapp');

/**
 * Generate video from text prompt
 */
async function generateVideoWithText(prompt, model = 'kling') {
  return await replicateGeneration.generateVideoWithText(prompt, model);
}

/**
 * Generate video from image and text prompt
 */
async function generateVideoFromImage(imageBuffer, prompt = null, model = 'kling') {
  return await replicateGeneration.generateVideoFromImage(imageBuffer, prompt, model);
}

/**
 * Generate video from video and text prompt
 */
async function generateVideoFromVideo(inputVideoBuffer, prompt) {
  return await replicateGeneration.generateVideoFromVideo(inputVideoBuffer, prompt);
}

/**
 * Generate video from image for WhatsApp
 */
async function generateVideoFromImageForWhatsApp(imageBuffer, prompt, req = null) {
  return await replicateWhatsApp.generateVideoFromImageForWhatsApp(imageBuffer, prompt, req);
}

/**
 * Generate video from video for WhatsApp
 */
async function generateVideoFromVideoForWhatsApp(videoBuffer, prompt, req = null) {
  return await replicateWhatsApp.generateVideoFromVideoForWhatsApp(videoBuffer, prompt, req);
}

/**
 * Generate video from text for WhatsApp
 */
async function generateVideoWithTextForWhatsApp(prompt, req = null) {
  return await replicateWhatsApp.generateVideoWithTextForWhatsApp(prompt, req);
}

module.exports = {
  generateVideoWithText,
  generateVideoFromImage,
  generateVideoFromVideo,
  generateVideoFromImageForWhatsApp,
  generateVideoFromVideoForWhatsApp,
  generateVideoWithTextForWhatsApp
};
