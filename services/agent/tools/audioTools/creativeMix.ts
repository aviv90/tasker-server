import { getServices } from '../../utils/serviceLoader';
import { creativeAudioService } from '../../../creativeAudioService';
import { saveBufferToTempFile } from '../../../../utils/tempFileUtils';
import { getStaticFileUrl } from '../../../../utils/urlUtils';

type CreativeMixArgs = {
  audio_url: string;
  style?: 'creative' | 'remix' | 'enhance' | string;
};

type CreativeMixResult = Promise<{
  success: boolean;
  data?: string;
  audioUrl?: string;
  error?: string;
}>;

export const creative_audio_mix = {
  declaration: {
    name: 'creative_audio_mix',
    description:
      'צור מיקס אודיו יצירתי עם אפקטים ומוזיקה מהקלטה. CRITICAL: אם בפרומפט יש "Use this audio_url parameter directly", קח את ה-URL משם ישירות ואל תקרא ל-get_chat_history! רק אם אין URL, קרא להיסטוריה.',
    parameters: {
      type: 'object',
      properties: {
        audio_url: {
          type: 'string',
          description:
            'URL של ההקלטה למיקס. אם זמין בפרומפט (בשורה "Use this audio_url parameter directly"), קח אותו משם.'
        },
        style: {
          type: 'string',
          description: 'סגנון המיקס (אפשרויות: creative, remix, enhance)'
        }
      },
      required: ['audio_url']
    }
  },
  execute: async (args: CreativeMixArgs): CreativeMixResult => {
    console.log('🔧 [Agent Tool] creative_audio_mix called');

    try {
      const { greenApiService } = getServices();

      const audioBuffer: Buffer = await greenApiService.downloadFile(args.audio_url);

      const result = await creativeAudioService.processVoiceCreatively(audioBuffer, 'mp3');

      if (!result.success || !result.audioBuffer) {
        return {
          success: false,
          error: `מיקס יצירתי נכשל: ${result.error || 'Unknown error'}`
        };
      }

      const tempFile = saveBufferToTempFile(result.audioBuffer, `creative_mix_${Date.now()}.mp3`);
      const audioUrl = getStaticFileUrl(tempFile.fileName, null);

      return {
        success: true,
        data: '✅ המיקס היצירתי נוצר בהצלחה!',
        audioUrl
      };
    } catch (error) {
      const err = error as Error;
      console.error('❌ Error in creative_audio_mix:', err);
      return {
        success: false,
        error: `שגיאה: ${err.message}`
      };
    }
  }
};

module.exports = { creative_audio_mix };

