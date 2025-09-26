const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { promisify } = require('util');

const execAsync = promisify(exec);

/**
 * Audio Converter Service
 * Handles conversion between different audio formats using FFmpeg
 */
class AudioConverterService {
    constructor() {
        this.tempDir = path.join(__dirname, '..', 'public', 'tmp');
        this.ensureTempDir();
    }

    ensureTempDir() {
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    /**
     * Convert audio buffer to Opus format for WhatsApp voice notes
     * @param {Buffer} audioBuffer - Input audio buffer
     * @param {string} inputFormat - Input format (mp3, wav, etc.)
     * @param {Object} options - Conversion options
     * @returns {Promise<Object>} - Result with opus buffer and file info
     */
    async convertToOpus(audioBuffer, inputFormat = 'mp3', options = {}) {
        return new Promise(async (resolve, reject) => {
            try {
                const inputFileName = `input_${uuidv4()}.${inputFormat}`;
                const outputFileName = `output_${uuidv4()}.opus`;
                const inputPath = path.join(this.tempDir, inputFileName);
                const outputPath = path.join(this.tempDir, outputFileName);

                // Write input audio buffer to temporary file
                fs.writeFileSync(inputPath, audioBuffer);

                console.log(`🔄 Converting ${inputFormat.toUpperCase()} to Opus: ${inputFileName} → ${outputFileName}`);

                // FFmpeg command for voice note conversion
                const ffmpegCommand = [
                    'ffmpeg',
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

                console.log(`🎵 FFmpeg command: ${ffmpegCommand}`);

                try {
                    const { stdout, stderr } = await execAsync(ffmpegCommand);
                    
                    if (stderr && stderr.includes('error')) {
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

                    console.log(`✅ Audio conversion completed: ${opusBuffer.length} bytes`);

                    resolve({
                        success: true,
                        opusBuffer: opusBuffer,
                        size: opusBuffer.length,
                        format: 'opus'
                    });

                } catch (ffmpegError) {
                    console.error('❌ FFmpeg conversion error:', ffmpegError);
                    
                    // Clean up temporary files
                    this.cleanupFile(inputPath);
                    this.cleanupFile(outputPath);
                    
                    reject(new Error(`Audio conversion failed: ${ffmpegError.message}`));
                }

            } catch (err) {
                console.error('❌ Error in audio conversion setup:', err);
                reject(new Error(`Conversion setup failed: ${err.message}`));
            }
        });
    }

    /**
     * Convert audio buffer to Opus and save to public directory
     * @param {Buffer} audioBuffer - Input audio buffer
     * @param {string} inputFormat - Input format (mp3, wav, etc.)
     * @param {Object} options - Conversion options
     * @returns {Promise<Object>} - Result with public file path
     */
    async convertAndSaveAsOpus(audioBuffer, inputFormat = 'mp3', options = {}) {
        try {
            console.log(`🔄 Converting ${inputFormat.toUpperCase()} to Opus for voice note...`);

            // Convert to Opus
            const conversionResult = await this.convertToOpus(audioBuffer, inputFormat, options);
            
            if (!conversionResult.success) {
                throw new Error('Conversion failed');
            }

            // Save Opus file to public directory
            const opusFileName = `voice_${uuidv4()}.opus`;
            const opusFilePath = path.join(this.tempDir, opusFileName);
            
            fs.writeFileSync(opusFilePath, conversionResult.opusBuffer);

            console.log(`✅ Opus file saved: ${opusFileName} (${conversionResult.opusBuffer.length} bytes)`);

            return {
                success: true,
                fileName: opusFileName,
                filePath: opusFilePath,
                publicPath: `/static/${opusFileName}`,
                buffer: conversionResult.opusBuffer,
                size: conversionResult.opusBuffer.length
            };

        } catch (err) {
            console.error('❌ Error in convertAndSaveAsOpus:', err);
            return {
                success: false,
                error: err.message || 'Audio conversion failed'
            };
        }
    }

    /**
     * Convert audio file from URL or local path to Opus
     * @param {string} audioUrl - URL or local path of the audio file
     * @param {string} inputFormat - Input format (mp3, wav, etc.)
     * @param {Object} options - Conversion options
     * @returns {Promise<Object>} - Result with opus buffer and file info
     */
    async convertUrlToOpus(audioUrl, inputFormat = 'mp3', options = {}) {
        try {
            console.log(`🔄 Converting audio from URL to Opus: ${audioUrl}`);

            let audioBuffer;

            // Check if it's a relative path (starts with /static/)
            if (audioUrl.startsWith('/static/')) {
                // Read from local file system
                const fs = require('fs');
                const path = require('path');
                
                // Handle both /static/ and /static/tmp/ paths
                let relativePath = audioUrl.replace('/static/', '');
                let filePath = path.join(__dirname, '..', 'public', relativePath);
                
                // If file not found in public/, try public/tmp/
                if (!fs.existsSync(filePath)) {
                    filePath = path.join(__dirname, '..', 'public', 'tmp', relativePath);
                }
                
                if (!fs.existsSync(filePath)) {
                    throw new Error(`File not found: ${filePath}`);
                }
                
                audioBuffer = fs.readFileSync(filePath);
                console.log(`📁 Read local file: ${filePath} (${audioBuffer.length} bytes)`);
            } else {
                // Download from URL
                const { downloadFile } = require('./greenApiService');
                audioBuffer = await downloadFile(audioUrl);
            }

            // Convert to Opus
            const conversionResult = await this.convertAndSaveAsOpus(audioBuffer, inputFormat, options);

            return conversionResult;

        } catch (err) {
            console.error('❌ Error in convertUrlToOpus:', err);
            return {
                success: false,
                error: err.message || 'URL to Opus conversion failed'
            };
        }
    }

    /**
     * Clean up temporary file
     * @param {string} filePath - Path to file to delete
     */
    cleanupFile(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`🧹 Cleaned up temporary file: ${path.basename(filePath)}`);
            }
        } catch (err) {
            console.warn(`⚠️ Failed to cleanup file ${filePath}:`, err.message);
        }
    }

    /**
     * Check if FFmpeg is available
     * @returns {Promise<boolean>} - True if FFmpeg is available
     */
    async checkFFmpegAvailability() {
        try {
            const { stdout, stderr } = await execAsync('ffmpeg -version');
            if (stderr && stderr.includes('error')) {
                console.error('❌ FFmpeg error:', stderr);
                return false;
            }
            console.log('✅ FFmpeg is available');
            return true;
        } catch (err) {
            console.error('❌ FFmpeg not available:', err.message);
            return false;
        }
    }
}

// Create and export instance
const audioConverterService = new AudioConverterService();

module.exports = {
    audioConverterService,
    AudioConverterService
};
