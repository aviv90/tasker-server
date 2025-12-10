import { getServices } from '../../utils/serviceLoader';
import voiceService from '../../../voiceService';
import { getAudioDuration } from '../../utils/audioUtils';
import logger from '../../../../utils/logger';
import { FAILED, ERROR } from '../../../../config/messages';
import { createTool } from '../base';

type TranslateArgs = {
  text: string;
  target_language: string;
};

type TranslationResponse = {
  error?: string;
  translatedText?: string;
  provider?: string;
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

const languageCodeMap: Record<string, string> = {
  english: 'en',
  hebrew: 'he',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  italian: 'it',
  portuguese: 'pt',
  russian: 'ru',
  chinese: 'zh',
  japanese: 'ja',
  korean: 'ko',
  arabic: 'ar',
  hindi: 'hi',
  turkish: 'tr',
  polish: 'pl',
  dutch: 'nl',
  swedish: 'sv',
  finnish: 'fi',
  norwegian: 'no',
  danish: 'da',
  czech: 'cs'
};

export const translate_text = createTool<TranslateArgs>(
  {
    name: 'translate_text',
    description: 'Translate text to another language (returns text only). To Speak it, use translate_and_speak! Supports 20+ languages.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to translate'
        },
        target_language: {
          type: 'string',
          description: 'Target language (English, Hebrew, Spanish, etc.)'
        }
      },
      required: ['text', 'target_language']
    }
  },
  async (args) => {
    logger.debug('🔧 [Agent Tool] translate_text called');

    try {
      const { geminiService } = getServices();

      const result = (await geminiService.translateText(args.text, args.target_language)) as TranslationResponse;

      if (result.error) {
        return {
          success: false,
          error: FAILED.TRANSLATION(result.error)
        };
      }

      return {
        success: true,
        data: result.translatedText,
        translation: result.translatedText,
        translatedText: result.translatedText,
        provider: result.provider || 'gemini'
      };
    } catch (error) {
      const err = error as Error;
      logger.error('❌ Error in translate_text:', err);
      return {
        success: false,
        error: ERROR.generic(err.message)
      };
    }
  }
);

export const translate_and_speak = createTool<TranslateArgs>(
  {
    name: 'translate_and_speak',
    description: 'Translate text AND convert to speech (returns audio + text). If quoted audio exists, clones the voice! Use when user asks: "Say X in Japanese", "Translate X and speak". DO NOT use for simple greetings.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to translate and speak'
        },
        target_language: {
          type: 'string',
          description: 'Target language'
        }
      },
      required: ['text', 'target_language']
    }
  },
  async (args, context) => {
    logger.debug(`🔧 [Agent Tool] translate_and_speak called: "${args.text}" -> ${args.target_language}`);

    let voiceId: string | null = null;
    let shouldDeleteVoice = false;

    try {
      const { geminiService, greenApiService } = getServices();

      const MIN_DURATION_FOR_CLONING = 4.6;
      const targetLangCode =
        languageCodeMap[args.target_language?.toLowerCase() || ''] || 'en';

      logger.info(`🌐 Translating to ${args.target_language}...`);
      const translationResult = (await geminiService.translateText(
        args.text,
        args.target_language
      )) as TranslationResponse;

      if (translationResult.error) {
        return {
          success: false,
          error: FAILED.TRANSLATION(translationResult.error)
        };
      }

      const translatedText = translationResult.translatedText || args.text;
      logger.info(`✅ Translated: "${translatedText}"`);

      const quotedAudioUrl = context.quotedContext?.audioUrl as string || context.audioUrl;

      if (quotedAudioUrl) {
        logger.info(
          `🎤 Quoted audio detected for voice cloning: ${quotedAudioUrl.substring(0, 50)}...`
        );

        try {
          const audioBuffer: Buffer = await greenApiService.downloadFile(quotedAudioUrl);
          const audioDuration = await getAudioDuration(audioBuffer);
          logger.info(
            `🎵 Quoted audio duration: ${audioDuration.toFixed(2)}s (minimum for cloning: ${MIN_DURATION_FOR_CLONING}s)`
          );

          if (audioDuration >= MIN_DURATION_FOR_CLONING) {
            logger.info('🎤 Attempting voice clone from quoted audio...');

            const voiceCloneOptions = {
              name: `Translate Voice Clone ${Date.now()}`,
              description: `Voice clone for translate_and_speak to ${args.target_language}`,
              removeBackgroundNoise: true,
              labels: JSON.stringify({
                accent: 'natural',
                use_case: 'conversational',
                quality: 'high',
                language: targetLangCode
              })
            };

            const voiceCloneResult = (await voiceService.createInstantVoiceClone(
              [audioBuffer],
              voiceCloneOptions
            )) as VoiceCloneResult;

            if (voiceCloneResult.error) {
              logger.warn(
                `⚠️ Voice cloning failed: ${voiceCloneResult.error}, using random voice`
              );
            } else {
              voiceId = voiceCloneResult.voiceId ?? null;
              shouldDeleteVoice = true;
              logger.info(`✅ Voice cloned successfully: ${voiceId}`);
            }
          } else {
            logger.info(
              `⏭️ Quoted audio too short for cloning (${audioDuration.toFixed(
                2
              )}s < ${MIN_DURATION_FOR_CLONING}s), using random voice`
            );
          }
        } catch (cloneError) {
          const err = cloneError as Error;
          logger.warn(
            `⚠️ Error during voice cloning process: ${err.message}, using random voice`
          );
        }
      }

      if (!voiceId) {
        logger.info(`🎤 Getting random voice for language: ${targetLangCode}...`);
        const voiceResult = (await voiceService.getVoiceForLanguage(targetLangCode)) as VoiceSelectionResult;

        if (voiceResult.error) {
          return {
            success: true,
            data: translatedText,
            translatedText,
            ttsError: `לא הצלחתי להמיר לדיבור: ${voiceResult.error}`
          };
        }

        voiceId = voiceResult.voiceId ?? null;
        logger.info(`✅ Using random voice: ${voiceId}`);
      }

      if (!voiceId) {
        return {
          success: true,
          data: translatedText,
          translatedText,
          ttsError: 'לא הצלחתי לבחור קול לדיבור'
        };
      }

      logger.info(`🗣️ Converting to speech with voice ${voiceId}...`);
      const ttsResult = (await voiceService.textToSpeech(voiceId, translatedText, {
        model_id: 'eleven_v3',
        optimize_streaming_latency: 0,
        output_format: 'mp3_44100_128',
        languageCode: targetLangCode
      })) as TTSResult;

      if (ttsResult.error) {
        return {
          success: true,
          data: translatedText,
          translatedText,
          ttsError: `לא הצלחתי להמיר לדיבור: ${ttsResult.error}`
        };
      }

      return {
        success: true,
        data: translatedText,
        translatedText,
        audioUrl: ttsResult.audioUrl,
        targetLanguage: args.target_language,
        languageCode: targetLangCode,
        voiceCloned: shouldDeleteVoice
      };
    } catch (error) {
      const err = error as Error;
      logger.error('❌ Error in translate_and_speak:', err);
      return {
        success: false,
        error: ERROR.generic(err.message)
      };
    } finally {
      if (shouldDeleteVoice && voiceId) {
        try {
          await voiceService.deleteVoice(voiceId as string);
          logger.info(`🧹 Cleanup: Cloned voice ${voiceId} deleted`);
        } catch (cleanupError) {
          const err = cleanupError as Error;
          logger.warn('⚠️ Voice cleanup failed:', err.message);
        }
      }
    }
  }
);
