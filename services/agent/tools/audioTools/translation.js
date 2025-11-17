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
    description: 'תרגם טקסט לשפה אחרת והמר לדיבור (מחזיר אודיו + טקסט). השתמש בכלי הזה כשהמשתמש מבקש: "אמור X ביפנית", "תרגם X לאנגלית ואמור", "say X in Spanish", וכו\'.',
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
    console.log(`🔧 [Agent Tool] translate_and_speak called`);

    try {
      const { geminiService } = getServices();

      // Try to parse TTS request to get optimal voice/language mapping
      let targetLangCode = 'en';
      try {
        const parseResult = await parseTextToSpeechRequest(`say ${args.text} in ${args.target_language}`);
        if (parseResult?.targetLanguage) {
          targetLangCode = parseResult.targetLanguage;
        }
      } catch (parseError) {
        console.warn('⚠️ Failed to parse language code, using default:', parseError.message);
      }

      // Step 1: Translate text
      const translationResult = await geminiService.translateText(args.text, args.target_language);

      if (translationResult.error) {
        return {
          success: false,
          error: `תרגום נכשל: ${translationResult.error}`
        };
      }

      const translatedText = translationResult.translatedText;

      // Step 2: Get appropriate voice for target language
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

      // Step 3: Convert to speech
      const ttsResult = await voiceService.textToSpeech(voiceResult.voiceId, translatedText, {
        model_id: 'eleven_v3',
        optimize_streaming_latency: 0,
        output_format: 'mp3_44100_128'
      });

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
        languageCode: targetLangCode
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

