/**
 * Gemini Image Generation & Editing
 * 
 * Image creation, editing, and analysis using Gemini AI.
 * Refactored to use modular components (Phase 5.3)
 */

// Import modular components
// eslint-disable-next-line @typescript-eslint/no-require-imports
const imageGenerationModule = require('./image/generation');
const imageGeneration = imageGenerationModule.default || imageGenerationModule;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const imageEditingModule = require('./image/editing');
const imageEditing = imageEditingModule.default || imageEditingModule;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const imageAnalysisModule = require('./image/analysis');
const imageAnalysis = imageAnalysisModule.default || imageAnalysisModule;
import { Request } from 'express';

/**
 * Generate image from text prompt
 */
export async function generateImageWithText(prompt: string): Promise<unknown> {
  return await imageGeneration.generateImageWithText(prompt);
}

/**
 * Generate image for WhatsApp from text prompt
 */
export async function generateImageForWhatsApp(prompt: string, req: Request | null = null): Promise<unknown> {
  return await imageGeneration.generateImageForWhatsApp(prompt, req);
}

/**
 * Edit image with text prompt
 */
export async function editImageWithText(prompt: string, base64Image: string): Promise<unknown> {
  return await imageEditing.editImageWithText(prompt, base64Image);
}

/**
 * Edit image for WhatsApp
 */
export async function editImageForWhatsApp(prompt: string, base64Image: string, req: Request | null): Promise<unknown> {
  return await imageEditing.editImageForWhatsApp(prompt, base64Image, req);
}

/**
 * Analyze image with text prompt
 */
export async function analyzeImageWithText(prompt: string, base64Image: string): Promise<unknown> {
  return await imageAnalysis.analyzeImageWithText(prompt, base64Image);
}

