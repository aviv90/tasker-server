import { getServices } from '../../utils/serviceLoader';
import voiceService from '../../../voiceService';
import { getAudioDuration } from '../../utils/audioUtils';

type TranslateArgs = {
  text: string;
  target_language: string;
};

type ToolContext = {
  chatId?: string;
  originalInput?: { language?: string };
  normalized?: { language?: string };
  quotedContext?: { audioUrl?: string };
  audioUrl?: string;
};

type ToolResult = Promise<{
  success: boolean;
  data?: string;
  translation?: string;
  translatedText?: string;
  provider?: string;
  audioUrl?: string;
  targetLanguage?: string;
  languageCode?: string;
  voiceCloned?: boolean;
  ttsError?: string;
  error?: string;
}>;

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

export const translate_text = {
  declaration: {
    name: 'translate_text',
    description:
      'תרגם טקסט לשפה אחרת (מחזיר טקסט בלבד). אם המשתמש אומר "אמור ביפנית" או "תרגם ואמור" - השתמש ב-translate_and_speak במקום! תומך ב-20+ שפות.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'הטקסט לתרגום'
        },
        target_language: {
          type: 'string',
          description:
            'שפת יעד (English, Hebrew, Spanish, French, German, Italian, Portuguese, Russian, Chinese, Japanese, Korean, Arabic, Hindi, Turkish, Polish, Dutch, Swedish, Finnish, Norwegian, Danish, Czech)'
        }
      },
      required: ['text', 'target_language']
    }
  },
  execute: async (args: TranslateArgs): ToolResult => {
    console.log('🔧 [Agent Tool] translate_text called');

    try {
      const { geminiService } = getServices();

      const result = (await geminiService.translateText(args.text, args.target_language)) as TranslationResponse;

      if (result.error) {
        return {
          success: false,
          error: `תרגום נכשל: ${result.error}`
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
      console.error('❌ Error in translate_text:', err);
      return {
        success: false,
        error: `שגיאה: ${err.message}`
      };
    }
  }
};

export const translate_and_speak = {
  declaration: {
    name: 'translate_and_speak',
    description:
      'תרגם טקסט לשפה אחרת והמר לדיבור (מחזיר אודיו + טקסט). אם יש הקלטה מצוטטת - משבט את הקול! השתמש בכלי הזה כשהמשתמש מבקש: "אמור X ביפנית", "תרגם X לאנגלית ואמור", "say X in Spanish", וכו\'.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'הטקסט לתרגום והקראה'
        },
        target_language: {
          type: 'string',
          description:
            'שפת יעד (English, Hebrew, Spanish, French, German, Italian, Portuguese, Russian, Chinese, Japanese, Korean, Arabic, etc.)'
        }
      },
      required: ['text', 'target_language']
    }
  },
  execute: async (args: TranslateArgs, context?: ToolContext): ToolResult => {
    console.log(`🔧 [Agent Tool] translate_and_speak called: "${args.text}" -> ${args.target_language}`);

    try {
      const { geminiService, greenApiService } = getServices();

      const MIN_DURATION_FOR_CLONING = 4.6;
      const targetLangCode =
        languageCodeMap[args.target_language?.toLowerCase() || ''] || 'en';

      console.log(`🌐 Translating to ${args.target_language}...`);
      const translationResult = (await geminiService.translateText(
        args.text,
        args.target_language
      )) as TranslationResponse;

      if (translationResult.error) {
        return {
          success: false,
          error: `תרגום נכשל: ${translationResult.error}`
        };
      }

      const translatedText = translationResult.translatedText || args.text;
      console.log(`✅ Translated: "${translatedText}"`);

      let voiceId: string | null = null;
      let shouldDeleteVoice = false;

      const quotedAudioUrl = context?.quotedContext?.audioUrl || context?.audioUrl;

      if (quotedAudioUrl) {
        console.log(`🎤 Quoted audio detected for voice cloning: ${quotedAudioUrl.substring(0, 50)}...`);

        try {
          const audioBuffer: Buffer = await greenApiService.downloadFile(quotedAudioUrl);
          const audioDuration = await getAudioDuration(audioBuffer);
          console.log(
            `🎵 Quoted audio duration: ${audioDuration.toFixed(2)}s (minimum for cloning: ${MIN_DURATION_FOR_CLONING}s)`
          );

          if (audioDuration >= MIN_DURATION_FOR_CLONING) {
            console.log('🎤 Attempting voice clone from quoted audio...');

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
              console.log(`⚠️ Voice cloning failed: ${voiceCloneResult.error}, using random voice`);
            } else {
              voiceId = voiceCloneResult.voiceId ?? null;
              shouldDeleteVoice = true;
              console.log(`✅ Voice cloned successfully: ${voiceId}`);
            }
          } else {
            console.log(
              `⏭️ Quoted audio too short for cloning (${audioDuration.toFixed(2)}s < ${MIN_DURATION_FOR_CLONING}s), using random voice`
            );
          }
        } catch (cloneError) {
          const err = cloneError as Error;
          console.log(`⚠️ Error during voice cloning process: ${err.message}, using random voice`);
        }
      }

      if (!voiceId) {
        console.log(`🎤 Getting random voice for language: ${targetLangCode}...`);
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
        console.log(`✅ Using random voice: ${voiceId}`);
      }

      if (!voiceId) {
        return {
          success: true,
          data: translatedText,
          translatedText,
          ttsError: 'לא הצלחתי לבחור קול לדיבור'
        };
      }

      console.log(`🗣️ Converting to speech with voice ${voiceId}...`);
      const ttsResult = (await voiceService.textToSpeech(voiceId, translatedText, {
        model_id: 'eleven_v3',
        optimize_streaming_latency: 0,
        output_format: 'mp3_44100_128',
        languageCode: targetLangCode
      })) as TTSResult;

      if (shouldDeleteVoice && voiceId) {
        try {
          await voiceService.deleteVoice(voiceId as string);
          console.log(`🧹 Cleanup: Cloned voice ${voiceId} deleted`);
        } catch (cleanupError) {
          const err = cleanupError as Error;
          console.warn('⚠️ Voice cleanup failed:', err.message);
        }
      }

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
      console.error('❌ Error in translate_and_speak:', err);
      return {
        success: false,
        error: `שגיאה: ${err.message}`
      };
    }
  }
};

export default {
  translate_text,
  translate_and_speak
};
