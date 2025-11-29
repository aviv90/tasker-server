/**
 * WhatsApp Media Handlers
 * 
 * Handles media-specific operations:
 * - Voice-to-voice conversations (STT + Voice Clone + TTS)
 * 
 * NOTE: Image editing, image-to-video, and video-to-video operations
 * are now handled by the Agent through its tools (edit_image, image_to_video, edit_video).
 * 
 * Refactored to use modular components (Phase 5.3)
 */

import { handleVoiceMessage } from './mediaHandlers/voiceHandlers';
import { getAudioDuration } from '../agent/utils/audioUtils';

export {
  handleVoiceMessage,
  getAudioDuration // Export for testing or reuse
};

