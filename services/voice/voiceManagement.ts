/**
 * Voice management helpers for ElevenLabs integration
 * Extracted from voiceService.js (Phase 5.3)
 */

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import logger from '../../utils/logger';

/**
 * Voice service context (for this binding)
 */
interface VoiceServiceContext {
  initializeClient: () => ElevenLabsClient;
}

/**
 * Voice list result
 */
interface VoiceListResult {
  voices?: unknown[];
  total?: number;
  error?: string;
}

/**
 * Voice details result
 */
interface VoiceDetailsResult {
  [key: string]: unknown;
  error?: string;
}

/**
 * Delete voice result
 */
interface DeleteVoiceResult {
  success?: boolean;
  voiceId?: string;
  error?: string;
}

/**
 * Get all voices
 */
export async function getVoices(this: VoiceServiceContext): Promise<VoiceListResult> {
  try {
    const client = this.initializeClient();
     
    const voices = await client.voices.getAll() as { voices?: unknown[]; data?: { voices?: unknown[] } };
    
    const voiceList = voices.voices || voices.data?.voices || [];
    
    logger.debug(`🎤 Retrieved ${voiceList.length} voices from ElevenLabs`);
    
    return {
      voices: voiceList,
      total: voiceList.length
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('❌ Error fetching voices:', { error: errorMessage, stack: err instanceof Error ? err.stack : undefined });
    return { error: errorMessage || 'Failed to fetch voices' };
  }
}

/**
 * Get voice details
 */
export async function getVoice(this: VoiceServiceContext, voiceId: string): Promise<VoiceDetailsResult> {
  try {
    const client = this.initializeClient();
     
    const voice = await client.voices.get(voiceId) as { data?: unknown } | unknown;
    
    return (voice && typeof voice === 'object' && 'data' in voice ? voice.data : voice) as VoiceDetailsResult || {};
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('❌ Error fetching voice:', { error: errorMessage, stack: err instanceof Error ? err.stack : undefined });
    return { error: errorMessage || 'Failed to fetch voice details' };
  }
}

/**
 * Delete a voice
 */
export async function deleteVoice(this: VoiceServiceContext, voiceId: string): Promise<DeleteVoiceResult> {
  try {
    const client = this.initializeClient();
    await client.voices.delete(voiceId);
    
    logger.info(`✅ Voice deleted: ${voiceId}`);
    return { success: true, voiceId };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('❌ Error deleting voice:', { error: errorMessage, stack: err instanceof Error ? err.stack : undefined });
    return { error: errorMessage || 'Failed to delete voice' };
  }
}

