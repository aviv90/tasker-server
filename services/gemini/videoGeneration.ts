/**
 * Gemini Video Generation & Analysis
 * 
 * Video creation, editing, and analysis using Gemini Veo.
 * Refactored to use modular components (Phase 5.3)
 */

// Import modular components
// eslint-disable-next-line @typescript-eslint/no-require-imports
const videoAnalysis = require('./video/analysis');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const veoGeneration = require('./video/veoGeneration');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const whatsappVideoGeneration = require('./video/whatsapp');
import { Request } from 'express';

/**
 * Analyze video with text prompt
 */
export async function analyzeVideoWithText(prompt: string, videoBuffer: Buffer): Promise<unknown> {
  return await videoAnalysis.analyzeVideoWithText(prompt, videoBuffer);
}

/**
 * Generate video from text prompt
 */
export async function generateVideoWithText(prompt: string): Promise<unknown> {
  return await veoGeneration.generateVideoWithText(prompt);
}

/**
 * Generate video from image and text prompt
 */
export async function generateVideoWithImage(prompt: string, imageBuffer: Buffer): Promise<unknown> {
  return await veoGeneration.generateVideoWithImage(prompt, imageBuffer);
}

/**
 * Generate video for WhatsApp from text prompt
 */
export async function generateVideoForWhatsApp(prompt: string, req: Request | null = null): Promise<unknown> {
  return await whatsappVideoGeneration.generateVideoForWhatsApp(prompt, req);
}

/**
 * Generate video for WhatsApp from image and text prompt
 */
export async function generateVideoFromImageForWhatsApp(prompt: string, imageBuffer: Buffer, req: Request | null = null): Promise<unknown> {
  return await whatsappVideoGeneration.generateVideoFromImageForWhatsApp(prompt, imageBuffer, req);
}

