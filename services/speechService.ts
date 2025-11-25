/**
 * Speech Service for ElevenLabs Speech-to-Text API integration
 * 
 * Uses the latest and most advanced models:
 * - scribe_v1_experimental: Latest STT model with improved multilingual performance,
 *   reduced hallucinations during silence, and better handling of early transcript termination
 * 
 * @version 2.0.0 - Updated to use experimental model for superior transcription quality
 */

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';

/**
 * Speech-to-text options
 */
interface SpeechToTextOptions {
  model?: string;
  format?: string;
  language?: string | null;
  logging?: boolean;
  diarize?: boolean;
  numSpeakers?: number;
  tagAudioEvents?: boolean;
  [key: string]: unknown;
}

/**
 * Transcription result
 */
interface TranscriptionResult {
  text?: string;
  result?: string;
  error?: string;
  metadata?: {
    service: string;
    model: string;
    language: string;
    confidence?: number | null;
    processing_time?: number | null;
    character_count: number;
    word_count: number;
    timestamp: string;
  };
}

/**
 * Audio file for batch processing
 */
interface AudioFile {
  buffer: Buffer;
  filename?: string;
  options?: SpeechToTextOptions;
}

/**
 * Batch processing result
 */
interface BatchResult {
  results?: Array<{
    filename: string;
    text: string;
    metadata: TranscriptionResult['metadata'];
  }>;
  errors?: Array<{
    filename: string;
    error: string;
  }>;
  summary?: {
    total_files: number;
    successful: number;
    failed: number;
    total_characters: number;
    total_words: number;
  };
  error?: string;
}

/**
 * Validation result
 */
interface ValidationResult {
  valid: boolean;
  error?: string;
  size?: number;
  format?: string;
}

/**
 * Temporary file result
 */
interface TempFileResult {
  path?: string;
  filename?: string;
  size?: number;
  error?: string;
}

class SpeechService {
    private client: ElevenLabsClient | null = null;
    private supportedFormats: string[];

    constructor() {
        // Don't initialize ElevenLabs client in constructor
        // Initialize it when first needed to ensure env vars are loaded
        this.client = null;
        
        // Supported audio formats for speech-to-text
        this.supportedFormats = [
            'mp3', 'wav', 'ogg', 'opus', 'webm', 
            'm4a', 'aac', 'flac', 'wma', 'aiff', 'aif'
        ];
    }

    /**
     * Initialize ElevenLabs client with lazy loading for environment variables
     * @returns Initialized ElevenLabs client
     */
    initializeClient(): ElevenLabsClient {
        if (!this.client) {
            if (!process.env.ELEVENLABS_API_KEY) {
                throw new Error('ELEVENLABS_API_KEY environment variable is required');
            }
            
            this.client = new ElevenLabsClient({
                apiKey: process.env.ELEVENLABS_API_KEY
            });
        }
        
        return this.client;
    }

    /**
     * Convert speech to text using ElevenLabs API
     * @param audioBuffer - Audio data buffer
     * @param options - Configuration options
     * @returns Transcription result with text and metadata
     */
    async speechToText(audioBuffer: Buffer, options: SpeechToTextOptions = {}): Promise<TranscriptionResult> {
        try {
            console.log(`🎤 ElevenLabs Speech-to-Text (${audioBuffer.length} bytes)`);
            
            if (!audioBuffer || !Buffer.isBuffer(audioBuffer)) {
                return { error: 'Invalid audio buffer provided' };
            }

            try {
                const client = this.initializeClient();
                
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
                        console.warn('⚠️ Could not clean up temp file');
                    }

                    interface TranscriptionResponse {
                        text?: string;
                        detected_language?: string;
                        confidence?: number;
                        processing_time_ms?: number;
                    }

                    const result = transcriptionResult as TranscriptionResponse;

                    if (!result || !result.text) {
                        return { error: 'Speech-to-text conversion failed - no text returned' };
                    }

                    const text = result.text.trim();
                    console.log(`✅ Transcription completed (${text.length} chars)`);

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

            } catch (transcriptionError) {
                throw transcriptionError;
            }

        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error('❌ ElevenLabs error:', errorMessage);
            
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

    /**
     * Batch process multiple audio files
     * @param audioFiles - Array of {buffer, filename, options}
     * @returns Batch processing results
     */
    async batchSpeechToText(audioFiles: AudioFile[] = []): Promise<BatchResult> {
        try {
            console.log(`🎤 Batch Speech-to-Text: ${audioFiles.length} files`);
            
            if (!Array.isArray(audioFiles) || audioFiles.length === 0) {
                return { error: 'No audio files provided for batch processing' };
            }

            const results: Array<{
                filename: string;
                text: string;
                metadata: TranscriptionResult['metadata'];
            }> = [];
            const errors: Array<{
                filename: string;
                error: string;
            }> = [];

            for (let i = 0; i < audioFiles.length; i++) {
                const file = audioFiles[i];
                if (!file) continue;
                const result = await this.speechToText(file.buffer, file.options || {});
                
                if (result.error) {
                    errors.push({
                        filename: file.filename || `file_${i + 1}`,
                        error: result.error
                    });
                } else if (result.text && result.metadata) {
                    results.push({
                        filename: file.filename || `file_${i + 1}`,
                        text: result.text,
                        metadata: result.metadata
                    });
                }

                // Small delay to respect rate limits
                if (i < audioFiles.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            console.log(`✅ Batch completed: ${results.length} success, ${errors.length} errors`);

            return {
                results: results,
                errors: errors,
                summary: {
                    total_files: audioFiles.length,
                    successful: results.length,
                    failed: errors.length,
                    total_characters: results.reduce((sum, r) => sum + r.text.length, 0),
                    total_words: results.reduce((sum, r) => sum + (r.metadata?.word_count || 0), 0)
                }
            };

        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error('❌ Batch processing error:', errorMessage);
            return { error: errorMessage || 'Batch processing failed' };
        }
    }

    /**
     * Get available models and languages
     * @returns Available options
     */
    getAvailableOptions(): {
        models: Array<{
            id: string;
            name: string;
            description: string;
            languages: string[];
        }>;
        supported_formats: string[];
        max_file_size: string;
        optimization_levels: Array<{
            level: number;
            description: string;
        }>;
    } {
        return {
            models: [
                {
                    id: 'scribe_v1',
                    name: 'Scribe v1',
                    description: 'ElevenLabs primary speech-to-text model',
                    languages: ['auto', 'en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'tr', 'ru', 'nl', 'cs', 'ar', 'zh', 'ja', 'hi']
                },
                {
                    id: 'scribe_v1_experimental',
                    name: 'Scribe v1 Experimental',
                    description: 'Experimental version with latest improvements',
                    languages: ['auto', 'en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'tr', 'ru', 'nl', 'cs', 'ar', 'zh', 'ja', 'hi']
                }
            ],
            supported_formats: this.supportedFormats,
            max_file_size: '25MB',
            optimization_levels: [
                { level: 0, description: 'No optimization (best quality)' },
                { level: 1, description: 'Light optimization' },
                { level: 2, description: 'Balanced optimization' },
                { level: 3, description: 'Aggressive optimization' },
                { level: 4, description: 'Maximum speed (lower quality)' }
            ]
        };
    }

    /**
     * Save audio buffer to temporary file
     * @param audioBuffer - Audio data
     * @param format - File format
     * @returns File path or error
     */
    // @ts-expect-error - Private method, may be used in future
    private async _saveTemporaryAudioFile(audioBuffer: Buffer, format: string = 'mp3'): Promise<TempFileResult> {
        try {
            if (!this.supportedFormats.includes(format.toLowerCase())) {
                return { error: `Unsupported audio format: ${format}` };
            }

            const filename = `temp_speech_${uuidv4()}.${format.toLowerCase()}`;
            // Use process.cwd() for safe path resolution
            const tempDir = path.join(process.cwd(), 'public', 'tmp');
            const filePath = path.join(tempDir, filename);

            // Ensure temp directory exists
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            // Write audio buffer to file
            fs.writeFileSync(filePath, audioBuffer);

            // Verify file was written
            const stats = fs.statSync(filePath);
            if (stats.size === 0) {
                return { error: 'Failed to write audio file' };
            }

            console.log(`💾 Temporary audio file saved: ${filename} (${stats.size} bytes)`);

            return {
                path: filePath,
                filename: filename,
                size: stats.size
            };

        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error('❌ Error saving temporary audio file:', err);
            return { error: errorMessage || 'Failed to save audio file' };
        }
    }

    /**
     * Clean up temporary file
     * @param filePath - Path to temporary file
     */
    // @ts-expect-error - Private method, may be used in future
    private _cleanupTemporaryFile(filePath: string): void {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`🗑️ Temporary file cleaned up: ${path.basename(filePath)}`);
            }
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.warn('⚠️ Failed to cleanup temporary file:', errorMessage);
        }
    }

    /**
     * Validate audio file before processing
     * @param audioBuffer - Audio buffer to validate
     * @param format - Expected format
     * @returns Validation result
     */
    validateAudioFile(audioBuffer: Buffer, format: string = 'mp3'): ValidationResult {
        try {
            if (!audioBuffer || !Buffer.isBuffer(audioBuffer)) {
                return { valid: false, error: 'Invalid audio buffer' };
            }

            if (audioBuffer.length === 0) {
                return { valid: false, error: 'Empty audio buffer' };
            }

            // Check file size (25MB limit for ElevenLabs)
            const maxSize = 25 * 1024 * 1024; // 25MB in bytes
            if (audioBuffer.length > maxSize) {
                return { 
                    valid: false, 
                    error: `Audio file too large: ${(audioBuffer.length / 1024 / 1024).toFixed(2)}MB (max 25MB)` 
                };
            }

            // Check format
            if (!this.supportedFormats.includes(format.toLowerCase())) {
                return { 
                    valid: false, 
                    error: `Unsupported format: ${format}. Supported: ${this.supportedFormats.join(', ')}` 
                };
            }

            return { 
                valid: true, 
                size: audioBuffer.length,
                format: format.toLowerCase()
            };

        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            return { valid: false, error: errorMessage };
        }
    }
}

// Create and export instance
const speechService = new SpeechService();

export default speechService;
export const speechToText = speechService.speechToText.bind(speechService);
export const batchSpeechToText = speechService.batchSpeechToText.bind(speechService);
export const getAvailableOptions = speechService.getAvailableOptions.bind(speechService);
export const validateAudioFile = speechService.validateAudioFile.bind(speechService);
export const initializeClient = speechService.initializeClient.bind(speechService);

