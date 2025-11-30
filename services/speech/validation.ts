import { ValidationResult } from './types';

export const SUPPORTED_FORMATS = [
    'mp3', 'wav', 'ogg', 'opus', 'webm',
    'm4a', 'aac', 'flac', 'wma', 'aiff', 'aif'
];

/**
 * Validate audio file before processing
 * @param audioBuffer - Audio buffer to validate
 * @param format - Expected format
 * @returns Validation result
 */
export function validateAudioFile(audioBuffer: Buffer, format: string = 'mp3'): ValidationResult {
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
        if (!SUPPORTED_FORMATS.includes(format.toLowerCase())) {
            return {
                valid: false,
                error: `Unsupported format: ${format}. Supported: ${SUPPORTED_FORMATS.join(', ')}`
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
