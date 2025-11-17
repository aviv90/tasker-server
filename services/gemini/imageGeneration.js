/**
 * Gemini Image Generation & Editing
 * 
 * Image creation, editing, and analysis using Gemini AI.
 * Refactored to use modular components (Phase 5.3)
 */

// Import modular components
const imageGeneration = require('./image/generation');
const imageEditing = require('./image/editing');
const imageAnalysis = require('./image/analysis');

/**
 * Generate image from text prompt
 */
async function generateImageWithText(prompt) {
  return await imageGeneration.generateImageWithText(prompt);
}

/**
 * Generate image for WhatsApp from text prompt
 */
async function generateImageForWhatsApp(prompt, req = null) {
  return await imageGeneration.generateImageForWhatsApp(prompt, req);
}

/**
 * Edit image with text prompt
 */
async function editImageWithText(prompt, base64Image) {
  return await imageEditing.editImageWithText(prompt, base64Image);
}

/**
 * Edit image for WhatsApp
 */
async function editImageForWhatsApp(prompt, base64Image, req) {
  return await imageEditing.editImageForWhatsApp(prompt, base64Image, req);
}

/**
 * Analyze image with text prompt
 */
async function analyzeImageWithText(prompt, base64Image) {
  return await imageAnalysis.analyzeImageWithText(prompt, base64Image);
}

module.exports = {
  generateImageWithText,
  generateImageForWhatsApp,
  editImageWithText,
  editImageForWhatsApp,
  analyzeImageWithText
};
