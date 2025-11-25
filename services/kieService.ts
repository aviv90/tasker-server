/**
 * Kie Service
 * 
 * Handles video generation via Kie.ai API (Veo 3).
 * Refactored to use modular components (Phase 5.3)
 */

// Handle default export from TypeScript
import TextToVideoService from './kie/textToVideo';
import ImageToVideoService from './kie/imageToVideo';

// Create instances
const textToVideoService = new TextToVideoService();
const imageToVideoService = new ImageToVideoService();

export const generateVideoWithText = textToVideoService.generateVideoWithText.bind(textToVideoService);
export const generateVideoWithImage = imageToVideoService.generateVideoWithImage.bind(imageToVideoService);

