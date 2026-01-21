/**
 * Replicate model constants
 */
export const MODELS = {
  TEXT_TO_VIDEO: "kwaivgi/kling-v2.1-master",
  IMAGE_TO_VIDEO: "kwaivgi/kling-v2.1-master",
  VIDEO_TO_VIDEO: "runwayml/gen4-aleph"
  // VEO3 REMOVED - Veo 3 must ONLY use Google Gemini API, not Replicate
} as const;

