import { transcribe_audio } from './audioTools/transcription';
import { text_to_speech, voice_clone_and_speak } from './audioTools/speech';
import { translate_text, translate_and_speak } from './audioTools/translation';
import { creative_audio_mix } from './audioTools/creativeMix';

export {
  transcribe_audio,
  text_to_speech,
  voice_clone_and_speak,
  creative_audio_mix,
  translate_text,
  translate_and_speak
};

module.exports = {
  transcribe_audio,
  text_to_speech,
  voice_clone_and_speak,
  creative_audio_mix,
  translate_text,
  translate_and_speak
};

