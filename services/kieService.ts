/**
 * Kie Service
 * 
 * Handles video generation via Kie.ai API (Veo 3).
 * Refactored to use modular components (Phase 5.3)
 */

// Handle default export from TypeScript
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TextToVideoServiceModule = require('./kie/textToVideo');
const TextToVideoService = TextToVideoServiceModule.default || TextToVideoServiceModule;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ImageToVideoServiceModule = require('./kie/imageToVideo');
const ImageToVideoService = ImageToVideoServiceModule.default || ImageToVideoServiceModule;

// Create instances
const textToVideoService = new TextToVideoService();
const imageToVideoService = new ImageToVideoService();

export const generateVideoWithText = textToVideoService.generateVideoWithText.bind(textToVideoService);
export const generateVideoWithImage = imageToVideoService.generateVideoWithImage.bind(imageToVideoService);

