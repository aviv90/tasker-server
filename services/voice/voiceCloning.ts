/**
 * Voice cloning helpers for ElevenLabs integration
 * Extracted from voiceService.js (Phase 5.3)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import logger from '../../utils/logger';

/**
 * Voice cloning options
 */
interface VoiceCloningOptions {
  name?: string;
  format?: string;
  removeBackgroundNoise?: boolean;
  description?: string;
  labels?: string;
  [key: string]: unknown;
}

/**
 * Voice cloning result
 */
interface VoiceCloningResult {
  success?: boolean;
  voiceId?: string;
  requiresVerification?: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Voice service context (for this binding)
 */
interface VoiceServiceContext {
  initializeClient: () => ElevenLabsClient;
}

/**
 * Create instant voice clone from audio buffers
 * @param audioBuffers - Audio buffer(s)
 * @param options - Voice cloning options
 * @returns Voice cloning result
 */
export async function createInstantVoiceClone(
  this: VoiceServiceContext,
  audioBuffers: Buffer | Buffer[],
  options: VoiceCloningOptions = {}
): Promise<VoiceCloningResult> {
  try {
    logger.info(`🎤 Creating instant voice clone: ${options.name || 'Unnamed Voice'}`);
    
    if (!audioBuffers) {
      return { error: 'No audio provided for voice cloning' };
    }

    // Ensure audioBuffers is an array
    const buffers = Array.isArray(audioBuffers) ? audioBuffers : [audioBuffers];
    
    // Validate all buffers
    for (let i = 0; i < buffers.length; i++) {
      if (!Buffer.isBuffer(buffers[i])) {
        return { error: `Invalid audio buffer at index ${i}` };
      }
    }

    const client = this.initializeClient();
    
    const tempFiles: string[] = [];
    const fileStreams: fs.ReadStream[] = [];

    try {
      // Create temporary files
      for (let i = 0; i < buffers.length; i++) {
        const buffer = buffers[i];
        if (!buffer) continue;
        const filename = `voice_sample_${Date.now()}_${i}.${options.format || 'wav'}`;
        const tempPath = path.join(os.tmpdir(), filename);
        
        fs.writeFileSync(tempPath, buffer);
        tempFiles.push(tempPath);
        fileStreams.push(fs.createReadStream(tempPath));
      }

      // Prepare voice cloning request
      interface VoiceRequest {
        name: string;
        files: fs.ReadStream[];
        removeBackgroundNoise: boolean;
        description: string;
        labels: string;
      }

      const voiceRequest: VoiceRequest = {
        name: options.name || `Voice_${Date.now()}`,
        files: fileStreams,
        removeBackgroundNoise: options.removeBackgroundNoise !== false,
        description: options.description || 'High-quality voice clone for conversational use',
        labels: options.labels || JSON.stringify({
          accent: 'natural',
          use_case: 'conversational',
          quality: 'high',
          style: 'natural',
          emotion: 'neutral'
        })
      };

      logger.debug(`🔄 Sending ${buffers.length} audio samples to ElevenLabs...`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (client.voices.ivc as any).create(voiceRequest);

      // Clean up temporary files
      tempFiles.forEach(tempPath => {
        try {
          fs.unlinkSync(tempPath);
        } catch (cleanupError) {
          logger.warn('⚠️ Could not clean up temp file:', { tempPath });
        }
      });

      logger.debug('🔍 Voice cloning result:', { result });

      interface VoiceCloningResponse {
        voiceId?: string;
        data?: { voiceId?: string };
        requiresVerification?: boolean;
      }

      const response = result as VoiceCloningResponse;
      const voiceId = response.voiceId || response.data?.voiceId;
      const requiresVerification = response.requiresVerification || false;

      if (!voiceId) {
        logger.error('❌ No voice ID in response:', { result });
        return { error: 'Voice cloning failed - no voice ID returned' };
      }

      logger.info(`✅ Voice clone created successfully: ${voiceId}`);

      return {
        success: true,
        voiceId,
        requiresVerification,
        data: result
      };
    } finally {
      // Ensure streams are closed
      fileStreams.forEach(stream => {
        try {
          stream?.destroy();
        } catch (streamError: unknown) {
          const errorMessage = streamError instanceof Error ? streamError.message : String(streamError);
          logger.warn('⚠️ Error closing stream:', { error: errorMessage });
        }
      });
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('❌ Voice cloning error:', { error: errorMessage, stack: err instanceof Error ? err.stack : undefined });
    return { error: errorMessage || 'Voice cloning failed' };
  }
}

/**
 * Voice cloning available options metadata
 * @returns Available options
 */
export function getAvailableOptions(): {
  supportedFormats: string[];
  maxFiles: number;
  maxFileSize: string;
  totalMaxSize: string;
  minDuration: string;
  maxDuration: string;
  recommendedDuration: string;
  features: {
    removeBackgroundNoise: string;
    description: string;
    labels: string;
  };
  notes: string[];
} {
  return {
    supportedFormats: ['wav', 'mp3', 'ogg', 'flac', 'm4a'],
    maxFiles: 25,
    maxFileSize: '10MB per file',
    totalMaxSize: '100MB total',
    minDuration: '1 second',
    maxDuration: '30 minutes per file',
    recommendedDuration: '1-5 minutes of high-quality audio',
    features: {
      removeBackgroundNoise: 'Automatically remove background noise',
      description: 'Add description for voice identification',
      labels: 'Add custom labels for organization'
    },
    notes: [
      'High-quality audio produces better voice clones',
      'Clear speech without background noise is recommended',
      'Multiple samples can improve voice quality',
      'Voice may require verification for certain use cases'
    ]
  };
}

