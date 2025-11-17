/**
 * Audio Tools - Transcription, TTS, Voice Cloning, Translation
 * 
 * Refactored to use modular components (Phase 5.3)
 */

const { transcribe_audio } = require('./audioTools/transcription');
const { text_to_speech, voice_clone_and_speak } = require('./audioTools/speech');
const { translate_text, translate_and_speak } = require('./audioTools/translation');
const { creative_audio_mix } = require('./audioTools/creativeMix');

module.exports = {
  transcribe_audio,
  text_to_speech,
  voice_clone_and_speak,
  creative_audio_mix,
  translate_text,
  translate_and_speak
};
