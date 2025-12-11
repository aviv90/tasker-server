/**
 * Sound Effects helper for ElevenLabs integration
 * Uses ElevenLabs Text-to-Sound-Effects API
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
 * Sound effect generation options
 */
interface SoundEffectOptions {
    /** Duration in seconds (0.5-30, default: auto-detect from prompt) */
    durationSeconds?: number;
    /** Whether the sound should loop smoothly */
    loop?: boolean;
    /** Output format (default: mp3_44100_128) */
    outputFormat?: string;
    /** Prompt influence (0-1, default: 0.3) - higher = follows prompt more closely */
    promptInfluence?: number;
}

/**
 * Sound effect generation result
 */
interface SoundEffectResult {
    audioUrl?: string;
    audioBuffer?: Buffer;
    text?: string;
    metadata?: {
        service: string;
        type: string;
        durationSeconds?: number;
        loop?: boolean;
        audioSize: number;
        created_at: string;
    };
    error?: string;
}

/**
 * Generate a sound effect from text description
 * @param text - Description of the sound effect (e.g., "Cinematic Braam, Horror")
 * @param options - Generation options
 * @returns Sound effect result with audio URL
 */
async function generateSoundEffect(
    this: VoiceServiceContext,
    text: string,
    options: SoundEffectOptions = {}
): Promise<SoundEffectResult> {
    try {
        logger.debug(`🔊 Generating sound effect: "${text.substring(0, 100)}..."`);

        if (!text || text.trim().length === 0) {
            return { error: 'Sound effect description is required' };
        }

        const client = this.initializeClient();

        // Build request parameters
        const requestParams: {
            text: string;
            outputFormat?: string;
            durationSeconds?: number;
            loop?: boolean;
            promptInfluence?: number;
        } = {
            text: text.trim(),
            outputFormat: options.outputFormat || 'mp3_44100_128',
            // Default duration if not specified (API auto-detect is often too short)
            durationSeconds: options.durationSeconds !== undefined
                ? Math.max(0.5, Math.min(30, options.durationSeconds))
                : 5.0, // Default to 5 seconds
            // Default prompt influence (API default 0.3 is often too loose)
            promptInfluence: options.promptInfluence !== undefined
                ? Math.max(0, Math.min(1, options.promptInfluence))
                : 0.5 // Default to 0.5
        };

        if (options.loop !== undefined) {
            requestParams.loop = options.loop;
            logger.debug(`🔁 Sound effect loop: ${options.loop}`);
        }

        logger.debug(`🔄 Requesting sound effect from ElevenLabs (Duration: ${requestParams.durationSeconds}s, Influence: ${requestParams.promptInfluence})...`);

        // Call ElevenLabs API
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const audioStream = await client.textToSoundEffects.convert(requestParams as any);

        // Collect audio chunks
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

        // Convert to buffer
        const audioBuffer = Buffer.concat(chunks.map(chunk => {
            if (chunk instanceof Uint8Array) {
                return Buffer.from(chunk);
            }
            return Buffer.from(new Uint8Array(chunk));
        }));

        // Save audio buffer to temp file
        const audioFileName = `sfx_${uuidv4()}.mp3`;
        const { publicPath: audioUrl } = saveBufferToTempFile(audioBuffer, audioFileName);

        logger.info(`✅ Sound effect generated successfully (${audioBuffer.length} bytes)`);
        logger.debug(`🔗 Audio available at: ${audioUrl}`);

        return {
            audioUrl,
            audioBuffer,
            text,
            metadata: {
                service: 'ElevenLabs',
                type: 'sound_effect',
                durationSeconds: options.durationSeconds,
                loop: options.loop,
                audioSize: audioBuffer.length,
                created_at: new Date().toISOString()
            }
        };

    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error('❌ Sound effect generation error:', errorMessage);

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
            const message = errorWithResponse.response.data?.detail ||
                errorWithResponse.response.data?.message ||
                errorMessage;

            if (status === 401) {
                return { error: 'Invalid ElevenLabs API key' };
            } else if (status === 402) {
                return { error: 'Insufficient ElevenLabs credits' };
            } else if (status === 422) {
                return { error: `Invalid parameters: ${message}` };
            } else {
                return { error: `ElevenLabs API error (${status}): ${message}` };
            }
        }

        return { error: errorMessage || 'Sound effect generation failed' };
    }
}

export { generateSoundEffect };
export type { SoundEffectOptions, SoundEffectResult };
