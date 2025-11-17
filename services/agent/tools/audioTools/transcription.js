/**
 * Transcription Tool
 */

const axios = require('axios');
const speechService = require('../../../speechService');
const { voiceService } = require('../../../voiceService');

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

module.exports = { transcribe_audio };

