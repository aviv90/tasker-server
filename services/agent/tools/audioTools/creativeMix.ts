import { getServices } from '../../utils/serviceLoader';
import { creativeAudioService } from '../../../creativeAudioService';
import { saveBufferToTempFile } from '../../../../utils/tempFileUtils';
import { getStaticFileUrl } from '../../../../utils/urlUtils';
import logger from '../../../../utils/logger';
import { FAILED, ERROR } from '../../../../config/messages';

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
    description: 'Create a creative audio mix with effects and music. CRITICAL: If prompt contains "Use this audio_url parameter directly", extract URL from there!',
    parameters: {
      type: 'object',
      properties: {
        audio_url: {
          type: 'string',
          description: 'Audio URL (from prompt "Use this audio_url parameter directly" if available)'
        },
        style: {
          type: 'string',
          description: 'Mix style (options: creative, remix, enhance)'
        }
      },
      required: ['audio_url']
    }
  },
  execute: async (args: CreativeMixArgs): CreativeMixResult => {
    logger.debug('🔧 [Agent Tool] creative_audio_mix called');

    try {
      const { greenApiService } = getServices();

      const audioBuffer: Buffer = await greenApiService.downloadFile(args.audio_url);

      const result = await creativeAudioService.processVoiceCreatively(audioBuffer, 'mp3');

      if (!result.success || !result.audioBuffer) {
        return {
          success: false,
          error: FAILED.CREATIVE_MIX(result.error || 'Unknown error')
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
      logger.error('❌ Error in creative_audio_mix:', { error: err.message, stack: err.stack });
      return {
        success: false,
        error: ERROR.generic(err.message)
      };
    }
  }
};

// ES6 exports only - CommonJS not needed in TypeScript
export default { creative_audio_mix };

