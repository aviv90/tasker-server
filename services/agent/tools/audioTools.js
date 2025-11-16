/**
 * Audio Tools - Transcription, TTS, Voice Cloning, Translation
 * Clean, modular tool definitions following SOLID principles
 */

const { getServices } = require('../utils/serviceLoader');

/**
 * Tool: Transcribe Audio
 */
const transcribe_audio = {
  declaration: {
    name: 'transcribe_audio',
    description: 'תמלל הקלטה קולית לטקסט (STT). CRITICAL: אם בפרומפט יש "Use this audio_url parameter directly", קח את ה-URL משם ישירות! אם לא, חלץ מהמבנה "[audioUrl: URL]" בפרומפט.',
    parameters: {
      type: 'object',
      properties: {
        audio_url: {
          type: 'string',
          description: 'URL של ההקלטה לתמלול. אם זמין בפרומפט (בשורה "Use this audio_url parameter directly"), קח אותו משם.'
        }
      },
      required: ['audio_url']
    }
  },
  execute: async (args, context) => {
    console.log(`🔧 [Agent Tool] transcribe_audio called`);
    
    try {
      const axios = require('axios');
      const speechService = require('../../speechService');
      const { voiceService } = require('../../voiceService');
      
      if (!args.audio_url) {
        return {
          success: false,
          error: 'לא נמצא URL של הקלטה. צטט הודעה קולית ונסה שוב.'
        };
      }
      
      // Download audio file
      console.log(`📥 Downloading audio: ${args.audio_url}`);
      const audioResponse = await axios.get(args.audio_url, { responseType: 'arraybuffer' });
      const audioBuffer = Buffer.from(audioResponse.data);
      
      // Transcribe
      console.log(`🎤 Transcribing audio...`);
      const transcriptionResult = await speechService.speechToText(audioBuffer, {
        response_format: 'verbose_json',
        timestamp_granularities: ['word']
      });
      
      if (transcriptionResult.error) {
        return {
          success: false,
          error: `תמלול נכשל: ${transcriptionResult.error}`
        };
      }
      
      const transcribedText = transcriptionResult.text || '';
      const detectedLanguage = transcriptionResult.detectedLanguage || voiceService.detectLanguage(transcribedText);
      
      console.log(`✅ Transcribed: "${transcribedText}" (${detectedLanguage})`);
      
      return {
        success: true,
        data: `📝 תמלול:\n\n"${transcribedText}"`,
        transcription: transcribedText,
        language: detectedLanguage
      };
    } catch (error) {
      console.error('❌ Error in transcribe_audio:', error);
      return {
        success: false,
        error: `שגיאה: ${error.message}`
      };
    }
  }
};

/**
 * Tool: Text to Speech
 */
const text_to_speech = {
  declaration: {
    name: 'text_to_speech',
    description: 'המר טקסט לדיבור. משתמש ב-ElevenLabs.',
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
  execute: async (args, context) => {
    console.log(`🔧 [Agent Tool] text_to_speech called`);
    
    try {
      const { voiceService } = require('../../voiceService');
      
      const language = args.language || 'he';
      const voiceResult = await voiceService.getVoiceForLanguage(language);
      
      if (voiceResult.error) {
        return {
          success: false,
          error: `לא נמצא קול לשפה: ${voiceResult.error}`
        };
      }
      
      const ttsResult = await voiceService.textToSpeech(voiceResult.voiceId, args.text, {
        model_id: 'eleven_v3',
        optimize_streaming_latency: 0,
        output_format: 'mp3_44100_128'
      });
      
      if (ttsResult.error) {
        return {
          success: false,
          error: `TTS נכשל: ${ttsResult.error}`
        };
      }
      
      return {
        success: true,
        data: `✅ הטקסט הומר לדיבור!`,
        audioUrl: ttsResult.audioUrl
      };
    } catch (error) {
      console.error('❌ Error in text_to_speech:', error);
      return {
        success: false,
        error: `שגיאה: ${error.message}`
      };
    }
  }
};

/**
 * Tool: Voice Clone and Speak
 */
const voice_clone_and_speak = {
  declaration: {
    name: 'voice_clone_and_speak',
    description: 'שבט קול מהקלטה קיימת והשתמש בו כדי לדבר טקסט חדש. CRITICAL: אם בפרומפט יש "Use this audio_url parameter directly", קח את ה-URL משם ישירות ואל תקרא ל-get_chat_history! רק אם אין URL, קרא ל-get_chat_history.',
    parameters: {
      type: 'object',
      properties: {
        audio_url: {
          type: 'string',
          description: 'URL של ההקלטה לשיבוט הקול. אם זמין בפרומפט (בשורה "Use this audio_url parameter directly"), קח אותו משם.'
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
  execute: async (args, context) => {
    console.log(`🔧 [Agent Tool] voice_clone_and_speak called`);
    
    try {
      const { voiceService } = require('../../voiceService');
      const { greenApiService } = getServices();
      
      // Download audio for cloning
      const audioBuffer = await greenApiService.downloadFile(args.audio_url);
      
      // Clone voice
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
      
      const cloneResult = await voiceService.createInstantVoiceClone(audioBuffer, voiceCloneOptions);
      
      if (cloneResult.error) {
        return {
          success: false,
          error: `שיבוט קול נכשל: ${cloneResult.error}`
        };
      }
      
      // Use cloned voice to speak text
      const ttsResult = await voiceService.textToSpeech(cloneResult.voiceId, args.text_to_speak, {
        model_id: 'eleven_v3',
        optimize_streaming_latency: 0,
        output_format: 'mp3_44100_128'
      });
      
      if (ttsResult.error) {
        return {
          success: false,
          error: `דיבור עם קול משובט נכשל: ${ttsResult.error}`
        };
      }
      
      return {
        success: true,
        data: `✅ שיבטתי את הקול והוא מדבר את הטקסט שביקשת!`,
        audioUrl: ttsResult.audioUrl,
        voiceId: cloneResult.voiceId
      };
    } catch (error) {
      console.error('❌ Error in voice_clone_and_speak:', error);
      return {
        success: false,
        error: `שגיאה: ${error.message}`
      };
    }
  }
};

/**
 * Tool: Creative Audio Mix
 */
const creative_audio_mix = {
  declaration: {
    name: 'creative_audio_mix',
    description: 'צור מיקס אודיו יצירתי עם אפקטים ומוזיקה מהקלטה. CRITICAL: אם בפרומפט יש "Use this audio_url parameter directly", קח את ה-URL משם ישירות ואל תקרא ל-get_chat_history! רק אם אין URL, קרא להיסטוריה.',
    parameters: {
      type: 'object',
      properties: {
        audio_url: {
          type: 'string',
          description: 'URL של ההקלטה למיקס. אם זמין בפרומפט (בשורה "Use this audio_url parameter directly"), קח אותו משם.'
        },
        style: {
          type: 'string',
          description: 'סגנון המיקס (אפשרויות: creative, remix, enhance)'
        }
      },
      required: ['audio_url']
    }
  },
  execute: async (args, context) => {
    console.log(`🔧 [Agent Tool] creative_audio_mix called`);
    
    try {
      const { creativeAudioService } = require('../../creativeAudioService');
      const { greenApiService } = getServices();
      
      // Download audio
      const audioBuffer = await greenApiService.downloadFile(args.audio_url);
      
      // Create creative mix
      const result = await creativeAudioService.createCreativeMix(audioBuffer, {
        style: args.style || 'creative',
        addMusic: true,
        addEffects: true
      });
      
      if (result.error) {
        return {
          success: false,
          error: `מיקס יצירתי נכשל: ${result.error}`
        };
      }
      
      return {
        success: true,
        data: `✅ המיקס היצירתי נוצר בהצלחה!`,
        audioUrl: result.url
      };
    } catch (error) {
      console.error('❌ Error in creative_audio_mix:', error);
      return {
        success: false,
        error: `שגיאה: ${error.message}`
      };
    }
  }
};

/**
 * Tool: Translate Text
 */
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

/**
 * Tool: Translate and Speak
 */
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
      const { voiceService } = require('../../voiceService');
      const { parseTextToSpeechRequest } = require('../../geminiService');
      
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
  transcribe_audio,
  text_to_speech,
  voice_clone_and_speak,
  creative_audio_mix,
  translate_text,
  translate_and_speak
};

