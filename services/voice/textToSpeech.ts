/**
 * Text-to-Speech helper for ElevenLabs integration
 * Extracted from voiceService.js (Phase 5.3)
 */

import { v4 as uuidv4 } from 'uuid';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { saveBufferToTempFile } from '../../utils/tempFileUtils';
import logger from '../../utils/logger';

/**
 * Voice service context (for this binding)
 */
interface VoiceServiceContext {
  initializeClient: () => ElevenLabsClient;
}

/**
 * TTS options
 */
interface TTSOptions {
  languageCode?: string;
  modelId?: string;
  outputFormat?: string;
  voiceSettings?: unknown;
  optimizeStreamingLatency?: number;
  [key: string]: unknown;
}

/**
 * TTS result
 */
interface TTSResult {
  audioUrl?: string;
  audioBuffer?: Buffer;
  voiceId?: string;
  text?: string;
  metadata?: {
    service: string;
    type: string;
    modelId: string;
    outputFormat: string;
    textLength: number;
    audioSize: number;
    created_at: string;
  };
  error?: string;
}

async function textToSpeech(
  this: VoiceServiceContext,
  voiceId: string,
  text: string,
  options: TTSOptions = {}
): Promise<TTSResult> {
  try {
    logger.debug(`🗣️ Converting text to speech with voice: ${voiceId}`);
    logger.debug(`📝 Text sample: "${text.substring(0, 100)}..."`);
    
    if (!voiceId || !text) {
      return { error: 'Voice ID and text are required' };
    }

    const client = this.initializeClient();
    
    // Determine language code
    let languageCode: string | null = options.languageCode || null;
    
    if (!languageCode) {
      if (text.match(/[\u0590-\u05FF]|[א-ת]/)) {
        languageCode = 'he';
      } else {
        languageCode = 'en';
      }
    }
    
    const languageMap: Record<string, string | null> = {
      'auto': null,
      'unknown': 'he',
      'hebrew': 'he',
      'he': 'he',
      'english': 'en',
      'en': 'en',
      'spanish': 'es',
      'es': 'es',
      'french': 'fr',
      'fr': 'fr',
      'german': 'de',
      'de': 'de',
      'italian': 'it',
      'it': 'it',
      'portuguese': 'pt',
      'pt': 'pt',
      'polish': 'pl',
      'pl': 'pl',
      'turkish': 'tr',
      'tr': 'tr',
      'russian': 'ru',
      'ru': 'ru',
      'dutch': 'nl',
      'nl': 'nl',
      'czech': 'cs',
      'cs': 'cs',
      'arabic': 'ar',
      'ar': 'ar',
      'chinese': 'zh',
      'zh': 'zh',
      'japanese': 'ja',
      'ja': 'ja',
      'hindi': 'hi',
      'hi': 'hi'
    };
    
    let finalLanguageCode: string | null = null;
    if (languageCode) {
      if (languageMap.hasOwnProperty(languageCode)) {
        finalLanguageCode = languageMap[languageCode] ?? null;
      } else {
        finalLanguageCode = languageCode;
      }
    }
    
    let modelId = options.modelId || 'eleven_v3';
    
    logger.debug(`🚀 Using Eleven v3 model for language: ${finalLanguageCode || 'auto-detect'}`);
    logger.debug(`🌐 Language code: ${finalLanguageCode || 'auto-detect'}, Model: ${modelId}`);
    
    interface TTSRequest {
      text: string;
      modelId: string;
      outputFormat: string;
      languageCode: string | null;
      voiceSettings: unknown;
      optimizeStreamingLatency?: number;
    }

    const ttsRequest: TTSRequest = {
      text: text,
      modelId: modelId,
      outputFormat: options.outputFormat || 'mp3_44100_128',
      languageCode: finalLanguageCode,
      voiceSettings: options.voiceSettings || null
    };

    if (modelId !== 'eleven_v3' && options.optimizeStreamingLatency !== undefined) {
      ttsRequest.optimizeStreamingLatency = options.optimizeStreamingLatency || 0;
      logger.debug(`⚡ Added streaming latency optimization: ${ttsRequest.optimizeStreamingLatency}`);
    } else if (modelId === 'eleven_v3') {
      logger.debug(`⚡ Eleven v3 model - streaming latency optimization not supported (and not needed)`);
    }

    logger.debug(`🔄 Generating speech for ${text.length} characters...`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const audioStream = await (client.textToSpeech as any).convert(voiceId, ttsRequest);

    const chunks: Uint8Array[] = [];
    const reader = audioStream.getReader();
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    const audioBuffer = Buffer.concat(chunks.map(chunk => {
      if (chunk instanceof Uint8Array) {
        return Buffer.from(chunk);
      }
      return Buffer.from(new Uint8Array(chunk));
    }));
    
    // Save audio buffer to centralized temp directory (SSOT with static route)
    const audioFileName = `tts_${uuidv4()}.mp3`;
    const { publicPath: audioUrl } = saveBufferToTempFile(audioBuffer, audioFileName);
    
    logger.info('✅ Text-to-speech conversion completed');
    logger.debug(`🔗 Audio available at: ${audioUrl}`);
    
    return {
      audioUrl: audioUrl,
      audioBuffer: audioBuffer,
      voiceId: voiceId,
      text: text,
      metadata: {
        service: 'ElevenLabs',
        type: 'text_to_speech',
        modelId: ttsRequest.modelId,
        outputFormat: ttsRequest.outputFormat,
        textLength: text.length,
        audioSize: audioBuffer.length,
        created_at: new Date().toISOString()
      }
    };

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('❌ Text-to-speech error:', errorMessage);
    
    interface ErrorResponse {
      response?: {
        status?: number;
        data?: {
          detail?: string;
          message?: string;
        };
      };
    }

    const errorWithResponse = err as ErrorResponse;
    if (errorWithResponse.response) {
      const status = errorWithResponse.response.status;
      const message = errorWithResponse.response.data?.detail || errorWithResponse.response.data?.message || errorMessage;
      
      if (status === 401) {
        return { error: 'Invalid ElevenLabs API key' };
      } else if (status === 402) {
        return { error: 'Insufficient ElevenLabs credits' };
      } else if (status === 404) {
        return { error: 'Voice not found' };
      } else if (status === 422) {
        return { error: `Invalid parameters: ${message}` };
      } else {
        return { error: `ElevenLabs API error (${status}): ${message}` };
      }
    }
    
    return { error: errorMessage || 'Text-to-speech conversion failed' };
  }
}

export { textToSpeech };

