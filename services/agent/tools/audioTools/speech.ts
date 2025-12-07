import { getServices } from '../../utils/serviceLoader';
import voiceService from '../../../voiceService';
import { getAudioDuration } from '../../utils/audioUtils';
import logger from '../../../../utils/logger';
import { NOT_FOUND, FAILED, UNABLE, ERROR } from '../../../../config/messages';
import { createTool } from '../base';

type TextToSpeechArgs = {
  text: string;
  language?: string;
  voice_description?: string;
};

type VoiceCloneArgs = {
  audio_url: string;
  text_to_speak: string;
  language?: string;
};

type VoiceCloneResult = {
  error?: string;
  voiceId?: string;
};

type VoiceSelectionResult = {
  error?: string;
  voiceId?: string;
};

type TTSResult = {
  error?: string;
  audioUrl?: string;
};

const MIN_DURATION_FOR_CLONING = 4.6;

export const text_to_speech = createTool<TextToSpeechArgs>(
  {
    name: 'text_to_speech',
    description: 'Convert text to speech (TTS). Use when user asks: "Say X", "Speak X", "Read X". If quoted audio exists, clones the voice! Uses ElevenLabs. CRITICAL: If user uses speaking verbs (Say/Speak), output MUST be audio!',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to speak'
        },
        language: {
          type: 'string',
          description: 'Language code (en, he, es, fr, etc.)'
        },
        voice_description: {
          type: 'string',
          description: 'Description of the desired voice (e.g. "Deep male voice", "Young American female"). Optional.'
        }
      },
      required: ['text']
    }
  },
  async (args, context) => {
    logger.debug(`🔧 [Agent Tool] text_to_speech called: "${args.text}"`);

    try {
      const { greenApiService } = getServices();
      const language = args.language || 'he';

      let voiceId: string | null = null;
      let shouldDeleteVoice = false;

      const quotedAudioUrl = context.quotedContext?.audioUrl as string || context.audioUrl;

      if (quotedAudioUrl) {
        logger.debug(`🎤 Quoted audio detected for voice cloning: ${quotedAudioUrl.substring(0, 50)}...`);

        try {
          const audioBuffer: Buffer = await greenApiService.downloadFile(quotedAudioUrl);
          const audioDuration = await getAudioDuration(audioBuffer);
          logger.debug(
            `🎵 Quoted audio duration: ${audioDuration.toFixed(2)}s (minimum for cloning: ${MIN_DURATION_FOR_CLONING}s)`
          );

          if (audioDuration >= MIN_DURATION_FOR_CLONING) {
            logger.debug('🎤 Attempting voice clone from quoted audio...');

            const voiceCloneOptions = {
              name: `TTS Voice Clone ${Date.now()}`,
              description: `Voice clone for text_to_speech`,
              removeBackgroundNoise: true,
              labels: JSON.stringify({
                accent: 'natural',
                use_case: 'conversational',
                quality: 'high',
                language
              })
            };

            const voiceCloneResult = (await voiceService.createInstantVoiceClone(
              [audioBuffer],
              voiceCloneOptions
            )) as VoiceCloneResult;

            if (voiceCloneResult.error) {
              logger.warn(`⚠️ Voice cloning failed: ${voiceCloneResult.error}, using random voice`);
            } else {
              voiceId = voiceCloneResult.voiceId ?? null;
              shouldDeleteVoice = true;
              logger.info(`✅ Voice cloned successfully: ${voiceId}`);
            }
          } else {
            logger.debug(
              `⏭️ Quoted audio too short for cloning (${audioDuration.toFixed(2)}s < ${MIN_DURATION_FOR_CLONING}s), using random voice`
            );
          }
        } catch (cloneError) {
          const err = cloneError as Error;
          logger.warn(`⚠️ Error during voice cloning process: ${err.message}, using random voice`);
        }
      }

      if (!voiceId) {
        logger.debug(`🎤 Getting random voice for language: ${language}...`);
        const voiceResult = (await voiceService.getVoiceForLanguage(language, args.voice_description)) as VoiceSelectionResult;

        if (voiceResult.error) {
          return {
            success: false,
            error: NOT_FOUND.voiceForLanguage(voiceResult.error)
          };
        }

        voiceId = voiceResult.voiceId ?? null;
        logger.debug(`✅ Using random voice: ${voiceId}`);
      }

      if (!voiceId) {
        return {
          success: false,
          error: UNABLE.CHOOSE_VOICE
        };
      }

      const ttsResult = (await voiceService.textToSpeech(voiceId, args.text, {
        model_id: 'eleven_v3',
        optimize_streaming_latency: 0,
        output_format: 'mp3_44100_128'
      })) as TTSResult;

      if (shouldDeleteVoice && voiceId) {
        try {
          await voiceService.deleteVoice(voiceId);
          logger.debug(`🧹 Cleanup: Cloned voice ${voiceId} deleted`);
        } catch (cleanupError) {
          const err = cleanupError as Error;
          logger.warn('⚠️ Voice cleanup failed:', { error: err.message });
        }
      }

      if (ttsResult.error) {
        return {
          success: false,
          error: FAILED.TTS(ttsResult.error)
        };
      }

      return {
        success: true,
        data: '✅ הטקסט הומר לדיבור!',
        audioUrl: ttsResult.audioUrl,
        voiceCloned: shouldDeleteVoice
      };
    } catch (error) {
      const err = error as Error;
      logger.error('❌ Error in text_to_speech:', { error: err.message, stack: err.stack });
      return {
        success: false,
        error: ERROR.generic(err.message)
      };
    }
  }
);

export const voice_clone_and_speak = createTool<VoiceCloneArgs>(
  {
    name: 'voice_clone_and_speak',
    description: 'Clone voice from an existing recording and use it to speak new text. CRITICAL: If prompt contains "Use this audio_url parameter directly", extract URL from there!',
    parameters: {
      type: 'object',
      properties: {
        audio_url: {
          type: 'string',
          description: 'URL of the audio recording to clone. If available in prompt "Use this audio_url...", take it.'
        },
        text_to_speak: {
          type: 'string',
          description: 'Text for the cloned voice to speak'
        },
        language: {
          type: 'string',
          description: 'Language code (he, en, es, etc.)'
        }
      },
      required: ['audio_url', 'text_to_speak']
    }
  },
  async (args) => {
    logger.debug('🔧 [Agent Tool] voice_clone_and_speak called');

    try {
      const { greenApiService } = getServices();

      const audioBuffer = await greenApiService.downloadFile(args.audio_url);

      const voiceCloneOptions = {
        name: `Agent Voice Clone ${Date.now()}`,
        description: `Voice clone from agent tool`,
        removeBackgroundNoise: true,
        labels: JSON.stringify({
          accent: 'natural',
          use_case: 'conversational',
          quality: 'high',
          language: args.language || 'he'
        })
      };

      const cloneResult = (await voiceService.createInstantVoiceClone(
        [audioBuffer],
        voiceCloneOptions
      )) as VoiceCloneResult;

      if (cloneResult.error || !cloneResult.voiceId) {
        return {
          success: false,
          error: cloneResult.error ? FAILED.VOICE_CLONE(cloneResult.error) : FAILED.VOICE_CLONE_NO_ID
        };
      }

      const ttsResult = (await voiceService.textToSpeech(cloneResult.voiceId, args.text_to_speak, {
        model_id: 'eleven_v3',
        optimize_streaming_latency: 0,
        output_format: 'mp3_44100_128'
      })) as TTSResult;

      if (ttsResult.error) {
        return {
          success: false,
          error: FAILED.CLONED_VOICE_SPEAK(ttsResult.error)
        };
      }

      return {
        success: true,
        data: '✅ שיבטתי את הקול והוא מדבר את הטקסט שביקשת!',
        audioUrl: ttsResult.audioUrl,
        voiceId: cloneResult.voiceId
      };
    } catch (error) {
      const err = error as Error;
      logger.error('❌ Error in voice_clone_and_speak:', { error: err.message, stack: err.stack });
      return {
        success: false,
        error: ERROR.generic(err.message)
      };
    }
  }
);

