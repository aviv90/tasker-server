/**
 * Creative Audio Mix Tool
 */

const { getServices } = require('../../utils/serviceLoader');
const { creativeAudioService } = require('../../../creativeAudioService');

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

module.exports = { creative_audio_mix };

