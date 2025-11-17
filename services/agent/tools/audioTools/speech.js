/**
 * Speech Tools - TTS and Voice Cloning
 */

const { getServices } = require('../../utils/serviceLoader');
const { voiceService } = require('../../../voiceService');

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

module.exports = {
  text_to_speech,
  voice_clone_and_speak
};

