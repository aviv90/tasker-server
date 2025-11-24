import { z } from 'zod';

/**
 * Schema for Agent Context
 */
export const contextSchema = z.object({
  toolCalls: z.array(z.any()).default([]), // Can be refined further if toolCall structure is strict
  generatedAssets: z.object({
    images: z.array(z.any()).default([]),
    videos: z.array(z.any()).default([]),
    audio: z.array(z.any()).default([])
  }).default({ images: [], videos: [], audio: [] })
});

