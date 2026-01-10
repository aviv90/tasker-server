import axios from 'axios';
import speechService from '../../../speechService';
import voiceService from '../../../voiceService';
import logger from '../../../../utils/logger';
import { NOT_FOUND, FAILED, ERROR, AGENT_INSTRUCTIONS } from '../../../../config/messages';
import { createTool } from '../base';
import { repairMediaUrl } from '../urlRepair';

type TranscribeArgs = {
  audio_url: string;
};

type SpeechTranscriptionResponse = {
  text?: string;
  detectedLanguage?: string;
  error?: string;
};

export const transcribe_audio = createTool<TranscribeArgs>(
  {
    name: 'transcribe_audio',
    description: 'Transcribe audio to text (STT). CRITICAL: If prompt contains "Use this audio_url parameter directly", extract URL from there!',
    parameters: {
      type: 'object',
      properties: {
        audio_url: {
          type: 'string',
          description: 'URL of audio to transcribe. If available in prompt "Use this audio_url...", take it.'
        }
      },
      required: ['audio_url']
    }
  },
  async (args, context) => {
    logger.debug('🔧 [Agent Tool] transcribe_audio called');

    try {
      const audioUrl = repairMediaUrl(args.audio_url, 'audio', context);

      if (!audioUrl) {
        return {
          success: false,
          error: NOT_FOUND.AUDIO_URL
        };
      }

      logger.debug(`📥 Downloading audio: ${audioUrl}`);
      const audioResponse = await axios.get<ArrayBuffer>(audioUrl, { responseType: 'arraybuffer' });
      const audioBuffer = Buffer.from(audioResponse.data);

      logger.debug('🎤 Transcribing audio...');
      const transcriptionResult = (await speechService.speechToText(audioBuffer, {
        response_format: 'verbose_json',
        timestamp_granularities: ['word']
      })) as SpeechTranscriptionResponse;

      if (transcriptionResult.error) {
        return {
          success: false,
          error: `${FAILED.TRANSCRIPTION(transcriptionResult.error)} ${AGENT_INSTRUCTIONS.STOP_ON_ERROR}`
        };
      }

      const transcribedText = transcriptionResult.text || '';
      const detectedLanguage =
        transcriptionResult.detectedLanguage || voiceService.detectLanguage(transcribedText);

      logger.info(`✅ Transcribed: "${transcribedText}" (${detectedLanguage})`);

      return {
        success: true,
        data: `📝 תמלול:\n\n"${transcribedText}"`,
        transcription: transcribedText,
        language: detectedLanguage
      };
    } catch (error) {
      const err = error as Error;
      logger.error('❌ Error in transcribe_audio:', { error: err.message, stack: err.stack });
      return {
        success: false,
        error: `${ERROR.generic(err.message)} ${AGENT_INSTRUCTIONS.STOP_ON_ERROR}`
      };
    }
  }
);

