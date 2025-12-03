import fs from 'fs';
import path from 'path';
import os from 'os';
import logger from '../../utils/logger';
import { SpeechToTextOptions, TranscriptionResult, TranscriptionResponse, ErrorResponse } from './types';
import { SpeechClient } from './client';

/**
 * Convert speech to text using ElevenLabs API
 * @param audioBuffer - Audio data buffer
 * @param options - Configuration options
 * @returns Transcription result with text and metadata
 */
export async function speechToText(audioBuffer: Buffer, options: SpeechToTextOptions = {}): Promise<TranscriptionResult> {
    try {
        logger.info(`🎤 ElevenLabs Speech-to-Text (${audioBuffer.length} bytes)`);

        if (!audioBuffer || !Buffer.isBuffer(audioBuffer)) {
            return { error: 'Invalid audio buffer provided' };
        }

        const client = SpeechClient.getInstance();

        const filename = `audio_${Date.now()}.${options.format || 'ogg'}`;
        const tempPath = path.join(os.tmpdir(), filename);

        try {
            fs.writeFileSync(tempPath, audioBuffer);
            const fileStream = fs.createReadStream(tempPath);

            const transcriptionRequest: Record<string, unknown> = {
                modelId: options.model || 'scribe_v1_experimental', // Use the latest experimental version with improved multilingual performance
                file: fileStream,
                languageCode: options.language || null,
                enableLogging: options.logging !== false
            };

            if (options.diarize !== undefined) {
                transcriptionRequest.diarize = options.diarize;
            }
            if (options.numSpeakers) {
                transcriptionRequest.numSpeakers = options.numSpeakers;
            }
            if (options.tagAudioEvents !== undefined) {
                transcriptionRequest.tagAudioEvents = options.tagAudioEvents;
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const transcriptionResult = await client.speechToText.convert(transcriptionRequest as any);

            // Clean up temporary file
            try {
                fs.unlinkSync(tempPath);
            } catch (cleanupError) {
                logger.warn('⚠️ Could not clean up temp file');
            }

            const result = transcriptionResult as TranscriptionResponse;

            if (!result || !result.text) {
                return { error: 'Speech-to-text conversion failed - no text returned' };
            }

            const text = result.text.trim();
            logger.info(`✅ Transcription completed (${text.length} chars)`);

            return {
                text: text,
                result: text,
                metadata: {
                    service: 'ElevenLabs',
                    model: options.model || 'scribe_v1_experimental', // Use the latest experimental version with improved multilingual performance
                    language: result.detected_language || options.language || 'auto',
                    confidence: result.confidence || null,
                    processing_time: result.processing_time_ms || null,
                    character_count: text.length,
                    word_count: text.split(/\s+/).filter(word => word.length > 0).length,
                    timestamp: new Date().toISOString()
                }
            };

        } catch (tempFileError: unknown) {
            try {
                if (fs.existsSync(tempPath)) {
                    fs.unlinkSync(tempPath);
                }
            } catch (cleanupError) {
                // Silent cleanup
            }
            throw tempFileError;
        }

    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error('❌ ElevenLabs error:', errorMessage);

        const errorWithResponse = err as ErrorResponse;

        if (errorWithResponse.response) {
            const status = errorWithResponse.response.status;
            const message = errorWithResponse.response.data?.detail || errorWithResponse.response.data?.message || errorMessage;

            if (status === 401) {
                return { error: 'Invalid ElevenLabs API key' };
            } else if (status === 402) {
                return { error: 'Insufficient ElevenLabs credits' };
            } else if (status === 413) {
                return { error: 'Audio file too large (max 25MB)' };
            } else if (status === 422) {
                return { error: `Audio format not supported: ${message}` };
            } else {
                return { error: `ElevenLabs API error (${status}): ${message}` };
            }
        }

        return { error: errorMessage || 'Speech-to-text conversion failed' };
    }
}
