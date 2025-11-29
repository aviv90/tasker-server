import { getServices } from '../../utils/serviceLoader';
import voiceService from '../../../voiceService';
import { getAudioDuration } from '../../utils/audioUtils';
import logger from '../../../../utils/logger';

type TextToSpeechArgs = {
  text: string;
  language?: string;
};

type VoiceCloneArgs = {
  audio_url: string;
  text_to_speak: string;
  language?: string;
};

type ToolContext = {
  quotedContext?: { audioUrl?: string };
  audioUrl?: string;
};

type ToolResponse = Promise<{
  success: boolean;
  data?: string;
  audioUrl?: string;
  voiceCloned?: boolean;
  error?: string;
  voiceId?: string;
}>;

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

export const text_to_speech = {
  declaration: {
    name: 'text_to_speech',
    description: 'המר טקסט לדיבור. אם יש הקלטה מצוטטת - משבט את הקול! משתמש ב-ElevenLabs.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'הטקסט להקראה'
        },
        language: {
          type: 'string',
          description: 'שפה להקראה (en, he, es, fr, etc.)'
        }
      },
      required: ['text']
    }
  },
  execute: async (args: TextToSpeechArgs, context?: ToolContext): ToolResponse => {
    logger.debug(`🔧 [Agent Tool] text_to_speech called: "${args.text}"`);

    try {
      const { greenApiService } = getServices();
      const language = args.language || 'he';

      let voiceId: string | null = null;
      let shouldDeleteVoice = false;

      const quotedAudioUrl = context?.quotedContext?.audioUrl || context?.audioUrl;

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
        const voiceResult = (await voiceService.getVoiceForLanguage(language)) as VoiceSelectionResult;

        if (voiceResult.error) {
          return {
            success: false,
            error: `לא נמצא קול לשפה: ${voiceResult.error}`
          };
        }

        voiceId = voiceResult.voiceId ?? null;
        logger.debug(`✅ Using random voice: ${voiceId}`);
      }

      if (!voiceId) {
        return {
          success: false,
          error: 'לא הצלחתי לבחור קול עבור ההקראה'
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
          error: `TTS נכשל: ${ttsResult.error}`
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
        error: `שגיאה: ${err.message}`
      };
    }
  }
};

export const voice_clone_and_speak = {
  declaration: {
    name: 'voice_clone_and_speak',
    description:
      'שבט קול מהקלטה קיימת והשתמש בו כדי לדבר טקסט חדש. CRITICAL: אם בפרומפט יש "Use this audio_url parameter directly", קח את ה-URL משם ישירות ואל תקרא ל-get_chat_history! רק אם אין URL, קרא ל-get_chat_history.',
    parameters: {
      type: 'object',
      properties: {
        audio_url: {
          type: 'string',
          description:
            'URL של ההקלטה לשיבוט הקול. אם זמין בפרומפט (בשורה "Use this audio_url parameter directly"), קח אותו משם.'
        },
        text_to_speak: {
          type: 'string',
          description: 'הטקסט שהקול המשובט ידבר'
        },
        language: {
          type: 'string',
          description: 'שפת הדיבור (he, en, es, etc.)'
        }
      },
      required: ['audio_url', 'text_to_speak']
    }
  },
  execute: async (args: VoiceCloneArgs): ToolResponse => {
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
          error: `שיבוט קול נכשל: ${cloneResult.error || 'לא הוחזר Voice ID'}`
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
          error: `דיבור עם קול משובט נכשל: ${ttsResult.error}`
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
        error: `שגיאה: ${err.message}`
      };
    }
  }
};

// ES6 exports only - CommonJS not needed in TypeScript
export default {
  text_to_speech,
  voice_clone_and_speak
};

