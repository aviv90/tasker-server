/**
 * Kie Service
 * 
 * Handles video generation via Kie.ai API (Veo 3).
 * Refactored to use modular components (Phase 5.3)
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TextToVideoService = require('./kie/textToVideo');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ImageToVideoService = require('./kie/imageToVideo');

// Create instances
const textToVideoService = new TextToVideoService();
const imageToVideoService = new ImageToVideoService();

export const generateVideoWithText = textToVideoService.generateVideoWithText.bind(textToVideoService);
export const generateVideoWithImage = imageToVideoService.generateVideoWithImage.bind(imageToVideoService);

