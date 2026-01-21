/**
 * Replicate Service
 * 
 * Video generation using Replicate (Kling, RunwayML).
 * NOTE: Veo 3 is NOT available via Replicate - use GeminiService for Veo 3.
 * Refactored to use modular components (Phase 5.3)
 */

// Handle default export from TypeScript
import replicateGeneration from './replicate/generation';
import replicateWhatsApp from './replicate/whatsapp';
import type { Request } from 'express';

/**
 * Shared result types for Replicate services
 * (kept in sync with ./replicate/generation and ./replicate/whatsapp)
 */
export interface ReplicateVideoGenerationResult {
  text?: string;
  result?: string;
  cost?: string;
  error?: string;
}

export interface ReplicateWhatsAppVideoResult {
  success: boolean;
  videoUrl?: string;
  description?: string;
  fileName?: string;
  error?: string;
}

/**
 * Generate video from text prompt
 */
export async function generateVideoWithText(
  prompt: string,
  model: string = 'kling'
): Promise<ReplicateVideoGenerationResult> {
  return await replicateGeneration.generateVideoWithText(prompt, model);
}

/**
 * Generate video from image and text prompt
 */
export async function generateVideoFromImage(
  imageBuffer: Buffer,
  prompt: string | null = null,
  model: string = 'kling'
): Promise<ReplicateVideoGenerationResult> {
  return await replicateGeneration.generateVideoFromImage(imageBuffer, prompt, model);
}

/**
 * Generate video from video and text prompt
 */
export async function generateVideoFromVideo(
  inputVideoBuffer: Buffer,
  prompt: string
): Promise<{ result?: string; error?: string }> {
  return await replicateGeneration.generateVideoFromVideo(inputVideoBuffer, prompt);
}

/**
 * Generate video for WhatsApp from text prompt
 */
export async function generateVideoWithTextForWhatsApp(
  prompt: string,
  req: Request | null = null
): Promise<ReplicateWhatsAppVideoResult> {
  return await replicateWhatsApp.generateVideoWithTextForWhatsApp(prompt, req);
}

/**
 * Generate video for WhatsApp from image and text prompt
 */
export async function generateVideoFromImageForWhatsApp(
  imageBuffer: Buffer,
  prompt: string | null = null,
  req: Request | null = null
): Promise<ReplicateWhatsAppVideoResult> {
  return await replicateWhatsApp.generateVideoFromImageForWhatsApp(imageBuffer, prompt || '', req);
}

/**
 * Generate video for WhatsApp from video and text prompt
 */
export async function generateVideoFromVideoForWhatsApp(
  inputVideoBuffer: Buffer,
  prompt: string,
  req: Request | null = null
): Promise<ReplicateWhatsAppVideoResult> {
  return await replicateWhatsApp.generateVideoFromVideoForWhatsApp(inputVideoBuffer, prompt, req);
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
