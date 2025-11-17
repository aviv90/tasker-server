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

const { handleImageEdit, handleImageToVideo } = require('./mediaHandlers/imageHandlers');
const { handleVideoToVideo } = require('./mediaHandlers/videoHandlers');
const { handleVoiceMessage } = require('./mediaHandlers/voiceHandlers');
const { getAudioDuration } = require('../agent/utils/audioUtils');

module.exports = {
  handleImageEdit,
  handleImageToVideo,
  handleVideoToVideo,
  handleVoiceMessage,
  getAudioDuration // Export for testing or reuse
};
