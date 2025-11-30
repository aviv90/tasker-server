import logger from '../../utils/logger';
import { TIME } from '../../utils/constants';
import { AudioFile, BatchResult, TranscriptionResult } from './types';
import { speechToText } from './transcription';

/**
 * Batch process multiple audio files
 * @param audioFiles - Array of {buffer, filename, options}
 * @returns Batch processing results
 */
export async function batchSpeechToText(audioFiles: AudioFile[] = []): Promise<BatchResult> {
    try {
        logger.info(`🎤 Batch Speech-to-Text: ${audioFiles.length} files`);

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
            const result = await speechToText(file.buffer, file.options || {});

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
                await new Promise(resolve => setTimeout(resolve, TIME.POLL_DELAY_CALLBACK));
            }
        }

        logger.info(`✅ Batch completed: ${results.length} success, ${errors.length} errors`);

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
        logger.error('❌ Batch processing error:', errorMessage);
        return { error: errorMessage || 'Batch processing failed' };
    }
}
