/**
 * Replicate model constants
 */
export const MODELS = {
  TEXT_TO_VIDEO: "kwaivgi/kling-3.0",
  IMAGE_TO_VIDEO: "kwaivgi/kling-3.0",
  VIDEO_TO_VIDEO: "runwayml/gen4.5"
  // VEO3 REMOVED - Veo 3 must ONLY use Google Gemini API, not Replicate
} as const;

