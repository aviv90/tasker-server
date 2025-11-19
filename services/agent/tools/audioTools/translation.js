/**
 * Translation Tools
 */

const { getServices } = require('../../utils/serviceLoader');
const { voiceService } = require('../../../voiceService');
const { parseTextToSpeechRequest } = require('../../../geminiService');

const translate_text = {
  declaration: {
    name: 'translate_text',
    description: 'תרגם טקסט לשפה אחרת (מחזיר טקסט בלבד). אם המשתמש אומר "אמור ביפנית" או "תרגם ואמור" - השתמש ב-translate_and_speak במקום! תומך ב-20+ שפות.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'הטקסט לתרגום'
        },
        target_language: {
          type: 'string',
          description: 'שפת יעד (English, Hebrew, Spanish, French, German, Italian, Portuguese, Russian, Chinese, Japanese, Korean, Arabic, Hindi, Turkish, Polish, Dutch, Swedish, Finnish, Norwegian, Danish, Czech)'
        }
      },
      required: ['text', 'target_language']
    }
  },
  execute: async (args, context) => {
    console.log(`🔧 [Agent Tool] translate_text called`);

    try {
      const { geminiService } = getServices();

      const result = await geminiService.translateText(args.text, args.target_language);

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
      console.error('❌ Error in translate_text:', error);
      return {
        success: false,
        error: `שגיאה: ${error.message}`
      };
    }
  }
};

const translate_and_speak = {
  declaration: {
    name: 'translate_and_speak',
    description: 'תרגם טקסט לשפה אחרת והמר לדיבור (מחזיר אודיו + טקסט). אם יש הקלטה מצוטטת - משבט את הקול! השתמש בכלי הזה כשהמשתמש מבקש: "אמור X ביפנית", "תרגם X לאנגלית ואמור", "say X in Spanish", וכו\'.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'הטקסט לתרגום והקראה'
        },
        target_language: {
          type: 'string',
          description: 'שפת יעד (English, Hebrew, Spanish, French, German, Italian, Portuguese, Russian, Chinese, Japanese, Korean, Arabic, etc.)'
        }
      },
      required: ['text', 'target_language']
    }
  },
  execute: async (args, context) => {
    console.log(`🔧 [Agent Tool] translate_and_speak called: "${args.text}" -> ${args.target_language}`);

    try {
      const { geminiService, greenApiService } = getServices();
      const { getAudioDuration } = require('../../../agent/utils/audioUtils');
      
      const MIN_DURATION_FOR_CLONING = 4.6; // seconds

      // Map target language to language code (optimized - no API call needed)
      const languageCodeMap = {
        'english': 'en', 'hebrew': 'he', 'spanish': 'es', 'french': 'fr',
        'german': 'de', 'italian': 'it', 'portuguese': 'pt', 'russian': 'ru',
        'chinese': 'zh', 'japanese': 'ja', 'korean': 'ko', 'arabic': 'ar',
        'hindi': 'hi', 'turkish': 'tr', 'polish': 'pl', 'dutch': 'nl',
        'swedish': 'sv', 'finnish': 'fi', 'norwegian': 'no', 'danish': 'da', 'czech': 'cs'
      };
      const targetLangCode = languageCodeMap[args.target_language?.toLowerCase()] || 'en';

      // Step 1: Translate text
      console.log(`🌐 Translating to ${args.target_language}...`);
      const translationResult = await geminiService.translateText(args.text, args.target_language);

      if (translationResult.error) {
        return {
          success: false,
          error: `תרגום נכשל: ${translationResult.error}`
        };
      }

      const translatedText = translationResult.translatedText;
      console.log(`✅ Translated: "${translatedText}"`);

      // Step 2: Handle voice selection (clone or random)
      let voiceId = null;
      let shouldDeleteVoice = false;
      
      // Check if there's a quoted audio for voice cloning
      const quotedAudioUrl = context?.quotedContext?.audioUrl || context?.audioUrl;
      
      if (quotedAudioUrl) {
        console.log(`🎤 Quoted audio detected for voice cloning: ${quotedAudioUrl.substring(0, 50)}...`);
        
        try {
          // Download audio file
          const audioBuffer = await greenApiService.downloadFile(quotedAudioUrl);
          
          // Get audio duration
          const audioDuration = await getAudioDuration(audioBuffer);
          console.log(`🎵 Quoted audio duration: ${audioDuration.toFixed(2)}s (minimum for cloning: ${MIN_DURATION_FOR_CLONING}s)`);
          
          if (audioDuration >= MIN_DURATION_FOR_CLONING) {
            console.log(`🎤 Attempting voice clone from quoted audio...`);
            
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
            
            const voiceCloneResult = await voiceService.createInstantVoiceClone(audioBuffer, voiceCloneOptions);
            
            if (voiceCloneResult.error) {
              console.log(`⚠️ Voice cloning failed: ${voiceCloneResult.error}, using random voice`);
            } else {
              voiceId = voiceCloneResult.voiceId;
              shouldDeleteVoice = true; // Mark for cleanup
              console.log(`✅ Voice cloned successfully: ${voiceId}`);
            }
          } else {
            console.log(`⏭️ Quoted audio too short for cloning (${audioDuration.toFixed(2)}s < ${MIN_DURATION_FOR_CLONING}s), using random voice`);
          }
        } catch (cloneError) {
          console.log(`⚠️ Error during voice cloning process: ${cloneError.message}, using random voice`);
        }
      }
      
      // If voice wasn't cloned, get random voice for target language
      if (!voiceId) {
        console.log(`🎤 Getting random voice for language: ${targetLangCode}...`);
        const voiceResult = await voiceService.getVoiceForLanguage(targetLangCode);

        if (voiceResult.error) {
          // Return translated text even if TTS fails
          return {
            success: true,
            data: translatedText,
            translatedText: translatedText,
            ttsError: `לא הצלחתי להמיר לדיבור: ${voiceResult.error}`
          };
        }

        voiceId = voiceResult.voiceId;
        console.log(`✅ Using random voice: ${voiceId}`);
      }

      // Step 3: Convert to speech
      console.log(`🗣️ Converting to speech with voice ${voiceId}...`);
      const ttsResult = await voiceService.textToSpeech(voiceId, translatedText, {
        model_id: 'eleven_v3',
        optimize_streaming_latency: 0,
        output_format: 'mp3_44100_128',
        languageCode: targetLangCode
      });

      // Cleanup: Delete cloned voice if it was created
      if (shouldDeleteVoice && voiceId) {
        try {
          await voiceService.deleteVoice(voiceId);
          console.log(`🧹 Cleanup: Cloned voice ${voiceId} deleted`);
        } catch (cleanupError) {
          console.warn('⚠️ Voice cleanup failed:', cleanupError.message);
        }
      }

      if (ttsResult.error) {
        // Return translated text even if TTS fails
        return {
          success: true,
          data: translatedText,
          translatedText: translatedText,
          ttsError: `לא הצלחתי להמיר לדיבור: ${ttsResult.error}`
        };
      }

      return {
        success: true,
        data: translatedText,
        translatedText: translatedText,
        audioUrl: ttsResult.audioUrl,
        targetLanguage: args.target_language,
        languageCode: targetLangCode,
        voiceCloned: shouldDeleteVoice
      };
    } catch (error) {
      console.error('❌ Error in translate_and_speak:', error);
      return {
        success: false,
        error: `שגיאה: ${error.message}`
      };
    }
  }
};

module.exports = {
  translate_text,
  translate_and_speak
};

