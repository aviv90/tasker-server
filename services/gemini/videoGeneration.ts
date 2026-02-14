/**
 * Gemini Video Generation & Analysis
 * 
 * Video creation, editing, and analysis using Gemini Veo.
 * Refactored to use modular components (Phase 5.3)
 */

// Import modular components
import videoAnalysis from './video/analysis';
import veoGeneration from './video/veoGeneration';
import whatsappVideoGeneration from './video/whatsapp';
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
export async function generateVideoWithText(prompt: string, options: { duration?: number } = {}): Promise<unknown> {
  return await veoGeneration.generateVideoWithText(prompt, options);
}

/**
 * Generate video from image and text prompt
 */
export async function generateVideoWithImage(prompt: string, imageBuffer: Buffer, options: { duration?: number } = {}): Promise<unknown> {
  return await veoGeneration.generateVideoWithImage(prompt, imageBuffer, options);
}

/**
 * Generate video for WhatsApp from text prompt
 */
export async function generateVideoForWhatsApp(prompt: string, req: Request | null = null, options: { duration?: number } = {}): Promise<unknown> {
  return await whatsappVideoGeneration.generateVideoForWhatsApp(prompt, req, options);
}

/**
 * Generate video for WhatsApp from image and text prompt
 */
export async function generateVideoFromImageForWhatsApp(prompt: string, imageBuffer: Buffer, req: Request | null = null, options: { duration?: number } = {}): Promise<unknown> {
  return await whatsappVideoGeneration.generateVideoFromImageForWhatsApp(prompt, imageBuffer, req, options);
}

