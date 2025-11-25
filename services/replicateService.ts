/**
 * Replicate Service
 * 
 * Video generation using Replicate (Kling, Veo 3, RunwayML).
 * Refactored to use modular components (Phase 5.3)
 */

// Handle default export from TypeScript
// eslint-disable-next-line @typescript-eslint/no-require-imports
const replicateGenerationModule = require('./replicate/generation');
const replicateGeneration = replicateGenerationModule.default || replicateGenerationModule;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const replicateWhatsAppModule = require('./replicate/whatsapp');
const replicateWhatsApp = replicateWhatsAppModule.default || replicateWhatsAppModule;

/**
 * Generate video from text prompt
 */
export async function generateVideoWithText(prompt: string, model: string = 'kling'): Promise<unknown> {
  return await replicateGeneration.generateVideoWithText(prompt, model);
}

/**
 * Generate video from image and text prompt
 */
export async function generateVideoFromImage(imageBuffer: Buffer, prompt: string | null = null, model: string = 'kling'): Promise<unknown> {
  return await replicateGeneration.generateVideoFromImage(imageBuffer, prompt, model);
}

/**
 * Generate video from video and text prompt
 */
export async function generateVideoFromVideo(inputVideoBuffer: Buffer, prompt: string): Promise<unknown> {
  return await replicateGeneration.generateVideoFromVideo(inputVideoBuffer, prompt);
}

/**
 * Generate video for WhatsApp from text prompt
 */
export async function generateVideoWithTextForWhatsApp(prompt: string, req: unknown = null): Promise<unknown> {
  return await replicateWhatsApp.generateVideoWithTextForWhatsApp(prompt, req);
}

/**
 * Generate video for WhatsApp from image and text prompt
 */
export async function generateVideoFromImageForWhatsApp(imageBuffer: Buffer, prompt: string | null = null, req: unknown = null): Promise<unknown> {
  return await replicateWhatsApp.generateVideoFromImageForWhatsApp(imageBuffer, prompt, req);
}

/**
 * Generate video for WhatsApp from video and text prompt
 */
export async function generateVideoFromVideoForWhatsApp(inputVideoBuffer: Buffer, prompt: string, req: unknown = null): Promise<unknown> {
  return await replicateWhatsApp.generateVideoFromVideoForWhatsApp(inputVideoBuffer, prompt, req);
}

