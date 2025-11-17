/**
 * Kie Service
 * 
 * Handles video generation via Kie.ai API (Veo 3).
 * Refactored to use modular components (Phase 5.3)
 */

const TextToVideoService = require('./kie/textToVideo');
const ImageToVideoService = require('./kie/imageToVideo');

// Create instances
const textToVideoService = new TextToVideoService();
const imageToVideoService = new ImageToVideoService();

module.exports = {
  generateVideoWithText: textToVideoService.generateVideoWithText.bind(textToVideoService),
  generateVideoWithImage: imageToVideoService.generateVideoWithImage.bind(imageToVideoService)
};
