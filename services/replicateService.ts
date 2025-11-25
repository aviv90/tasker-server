/**
 * Replicate Service
 * 
 * Video generation using Replicate (Kling, Veo 3, RunwayML).
 * Refactored to use modular components (Phase 5.3)
 */

// Handle default export from TypeScript
import replicateGeneration from './replicate/generation';
import replicateWhatsApp from './replicate/whatsapp';

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

import { Request } from 'express';

// ...

/**
 * Generate video for WhatsApp from text prompt
 */
export async function generateVideoWithTextForWhatsApp(prompt: string, req: unknown = null): Promise<unknown> {
  return await replicateWhatsApp.generateVideoWithTextForWhatsApp(prompt, req as Request | null);
}

/**
 * Generate video for WhatsApp from image and text prompt
 */
export async function generateVideoFromImageForWhatsApp(imageBuffer: Buffer, prompt: string | null = null, req: unknown = null): Promise<unknown> {
  return await replicateWhatsApp.generateVideoFromImageForWhatsApp(imageBuffer, prompt || '', req as Request | null);
}

/**
 * Generate video for WhatsApp from video and text prompt
 */
export async function generateVideoFromVideoForWhatsApp(inputVideoBuffer: Buffer, prompt: string, req: unknown = null): Promise<unknown> {
  return await replicateWhatsApp.generateVideoFromVideoForWhatsApp(inputVideoBuffer, prompt, req as Request | null);
}

const replicateService = {
  generateVideoWithText,
  generateVideoFromImage,
  generateVideoFromVideo,
  generateVideoWithTextForWhatsApp,
  generateVideoFromImageForWhatsApp,
  generateVideoFromVideoForWhatsApp
};

export default replicateService;
