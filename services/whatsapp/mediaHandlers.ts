/**
 * WhatsApp Media Handlers
 * 
 * Handles media-specific operations:
 * - Image editing (Gemini, OpenAI)
 * - Image-to-video conversion (Veo 3, Sora 2, Kling)
 * - Video-to-video processing (RunwayML Gen4)
 * - Voice-to-voice conversations (STT + Voice Clone + TTS)
 * 
 * Refactored to use modular components (Phase 5.3)
 */

import { handleImageEdit, handleImageToVideo } from './mediaHandlers/imageHandlers';
import { handleVideoToVideo } from './mediaHandlers/videoHandlers';
import { handleVoiceMessage } from './mediaHandlers/voiceHandlers';
import { getAudioDuration } from '../agent/utils/audioUtils';

export {
  handleImageEdit,
  handleImageToVideo,
  handleVideoToVideo,
  handleVoiceMessage,
  getAudioDuration // Export for testing or reuse
};

