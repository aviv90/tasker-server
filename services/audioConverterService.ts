/**
 * Audio Converter Service
 * Handles conversion between different audio formats using FFmpeg
 */

import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { promisify } from 'util';
import { downloadFile } from './greenApiService';
import logger from '../utils/logger';
const execAsync = promisify(exec);
const ffmpeg = 'ffmpeg';

/**
 * Conversion options
 */
interface ConversionOptions {
    bitrate?: string;
    [key: string]: unknown;
}

/**
 * Conversion result
 */
interface ConversionResult {
    success: boolean;
    opusBuffer?: Buffer;
    size?: number;
    format?: string;
    error?: string;
}

/**
 * Save result
 */
interface SaveResult {
    success: boolean;
    fileName?: string;
    filePath?: string;
    publicPath?: string;
    buffer?: Buffer;
    size?: number;
    error?: string;
}

class AudioConverterService {
    private tempDir: string;

    constructor() {
        // Use process.cwd() to ensure we point to the project root public directory,
        // not the dist/ folder structure in production.
        // Use config.paths.tmp for consistent path resolution
        const { config } = require('../config');
        this.tempDir = config.paths.tmp;
        this.ensureTempDir();
    }

    private ensureTempDir(): void {
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    /**
     * Convert audio buffer to Opus format for WhatsApp voice notes
     * @param audioBuffer - Input audio buffer
     * @param inputFormat - Input format (mp3, wav, etc.)
     * @param options - Conversion options
     * @returns Result with opus buffer and file info
     */
    async convertToOpus(audioBuffer: Buffer, inputFormat: string = 'mp3', options: ConversionOptions = {}): Promise<ConversionResult> {
        return new Promise(async (resolve, reject) => {
            try {
                const inputFileName = `input_${uuidv4()}.${inputFormat}`;
                const outputFileName = `output_${uuidv4()}.opus`;
                const inputPath = path.join(this.tempDir, inputFileName);
                const outputPath = path.join(this.tempDir, outputFileName);

                // Write input audio buffer to temporary file
                fs.writeFileSync(inputPath, audioBuffer);

                logger.info(`🔄 Converting ${inputFormat.toUpperCase()} to Opus: ${inputFileName} → ${outputFileName}`);

                // FFmpeg command for voice note conversion
                const ffmpegCommand = [
                    ffmpeg,
                    '-i', inputPath,
                    '-c:a', 'libopus',
                    '-b:a', options.bitrate || '32k',
                    '-ac', '1', // Mono
                    '-ar', '16000', // 16kHz sample rate
                    '-application', 'voip', // Optimize for voice
                    '-vbr', 'on', // Variable bitrate
                    '-compression_level', '10', // High compression
                    '-y', // Overwrite output file
                    outputPath
                ].join(' ');

                logger.debug(`🎵 FFmpeg command: ${ffmpegCommand}`);

                try {
                    const { stderr } = await execAsync(ffmpegCommand);

                    if (stderr && typeof stderr === 'string' && stderr.includes('error')) {
                        throw new Error(`FFmpeg error: ${stderr}`);
                    }

                    // Read the converted Opus file
                    if (!fs.existsSync(outputPath)) {
                        throw new Error('Output file was not created');
                    }

                    const opusBuffer = fs.readFileSync(outputPath);

                    // Clean up temporary files
                    this.cleanupFile(inputPath);
                    this.cleanupFile(outputPath);

                    logger.info(`✅ Audio conversion completed: ${opusBuffer.length} bytes`);

                    resolve({
                        success: true,
                        opusBuffer: opusBuffer,
                        size: opusBuffer.length,
                        format: 'opus'
                    });

                } catch (ffmpegError: unknown) {
                    const errorMessage = ffmpegError instanceof Error ? ffmpegError.message : String(ffmpegError);
                    logger.error('❌ FFmpeg conversion error:', ffmpegError as Error);

                    // Clean up temporary files
                    this.cleanupFile(inputPath);
                    this.cleanupFile(outputPath);

                    reject(new Error(`Audio conversion failed: ${errorMessage}`));
                }

            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                logger.error('❌ Error in audio conversion setup:', err as Error);
                reject(new Error(`Conversion setup failed: ${errorMessage}`));
            }
        });
    }

    /**
     * Convert audio buffer to Opus and save to public directory
     * @param audioBuffer - Input audio buffer
     * @param inputFormat - Input format (mp3, wav, etc.)
     * @param options - Conversion options
     * @returns Result with public file path
     */
    async convertAndSaveAsOpus(audioBuffer: Buffer, inputFormat: string = 'mp3', options: ConversionOptions = {}): Promise<SaveResult> {
        try {
            logger.info(`🔄 Converting ${inputFormat.toUpperCase()} to Opus for voice note...`);

            // Convert to Opus
            const conversionResult = await this.convertToOpus(audioBuffer, inputFormat, options);

            if (!conversionResult.success || !conversionResult.opusBuffer) {
                throw new Error('Conversion failed');
            }

            // Save Opus file to public directory
            const opusFileName = `voice_${uuidv4()}.opus`;
            const opusFilePath = path.join(this.tempDir, opusFileName);

            // Ensure directory exists
            if (!fs.existsSync(this.tempDir)) {
                fs.mkdirSync(this.tempDir, { recursive: true });
                logger.info(`📁 Created temp directory: ${this.tempDir}`);
            }

            fs.writeFileSync(opusFilePath, conversionResult.opusBuffer);

            // Verify file was written correctly
            if (!fs.existsSync(opusFilePath)) {
                throw new Error(`Opus file was not created: ${opusFilePath}`);
            }

            const fileStats = fs.statSync(opusFilePath);
            logger.info(`✅ Opus file saved: ${opusFileName} (${fileStats.size} bytes)`);
            logger.debug(`📁 Full path: ${opusFilePath}`);

            return {
                success: true,
                fileName: opusFileName,
                filePath: opusFilePath,
                publicPath: `/static/${opusFileName}`,
                buffer: conversionResult.opusBuffer,
                size: conversionResult.opusBuffer.length
            };

        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            logger.error('❌ Error in convertAndSaveAsOpus:', err as Error);
            return {
                success: false,
                error: errorMessage || 'Audio conversion failed'
            };
        }
    }

    /**
     * Convert audio file from URL or local path to Opus
     * @param audioUrl - URL or local path of the audio file
     * @param inputFormat - Input format (mp3, wav, etc.)
     * @param options - Conversion options
     * @returns Result with opus buffer and file info
     */
    async convertUrlToOpus(audioUrl: string, inputFormat: string = 'mp3', options: ConversionOptions = {}): Promise<SaveResult> {
        try {
            logger.info(`🔄 Converting audio from URL to Opus: ${audioUrl}`);

            let audioBuffer: Buffer;

            // Check if it's a relative path (starts with /static/)
            if (audioUrl.startsWith('/static/')) {
                // Read from local file system
                // Handle both /static/ and /static/tmp/ paths
                let relativePath = audioUrl.replace('/static/', '');

                // Use process.cwd() to resolve path relative to project root
                let filePath = path.join(process.cwd(), 'public', relativePath);

                // If file not found in public/, try public/tmp/
                if (!fs.existsSync(filePath)) {
                    // Use config.paths.tmp for consistent path resolution
                    const { config } = require('../config');
                    filePath = path.join(config.paths.tmp, relativePath);
                }

                if (!fs.existsSync(filePath)) {
                    throw new Error(`File not found: ${filePath}`);
                }

                audioBuffer = fs.readFileSync(filePath);
                logger.info(`📁 Read local file: ${filePath} (${audioBuffer.length} bytes)`);
            } else {
                // Download from URL
                audioBuffer = await downloadFile(audioUrl) as Buffer;
            }

            // Convert to Opus
            const conversionResult = await this.convertAndSaveAsOpus(audioBuffer, inputFormat, options);

            return conversionResult;

        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            logger.error('❌ Error in convertUrlToOpus:', err as Error);
            return {
                success: false,
                error: errorMessage || 'URL to Opus conversion failed'
            };
        }
    }

    /**
     * Clean up temporary file
     * @param filePath - Path to file to delete
     */
    cleanupFile(filePath: string): void {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                logger.debug(`🧹 Cleaned up temporary file: ${path.basename(filePath)}`);
            }
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            logger.warn(`⚠️ Failed to cleanup file ${filePath}: ${errorMessage}`);
        }
    }

    /**
     * Check if FFmpeg is available
     * @returns True if FFmpeg is available
     */
    async checkFFmpegAvailability(): Promise<boolean> {
        try {
            const { stderr } = await execAsync(`${ffmpeg} -version`);
            if (stderr && typeof stderr === 'string' && stderr.includes('error')) {
                logger.error('❌ FFmpeg error:', stderr);
                return false;
            }
            logger.info('✅ FFmpeg is available');
            return true;
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            logger.error('❌ FFmpeg not available:', errorMessage);
            return false;
        }
    }
}

// Create and export instance
const audioConverterService = new AudioConverterService();

export default audioConverterService;
export { audioConverterService, AudioConverterService };

