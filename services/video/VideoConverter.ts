import { promisify } from 'util';
import { exec } from 'child_process';
import fs from 'fs';
import ffmpegStatic from 'ffmpeg-static';
import logger from '../../utils/logger';
import { createTempFilePath } from '../../utils/tempFileUtils';

const execAsync = promisify(exec);
const ffmpeg = ffmpegStatic || 'ffmpeg';

export interface ConvertResult {
    success: boolean;
    fallback?: boolean;
    filePath: string;
    fileName: string;
}

export class VideoConverter {
    /**
     * Convert video to WhatsApp-compatible format
     * Uses libx264, aac, and faststart for streaming
     */
    async convertVideoForWhatsApp(filePath: string, fileName: string): Promise<ConvertResult> {
        logger.info('🎬 Converting video to WhatsApp-compatible format...');
        const convertedFileName = fileName.replace('.mp4', '_converted.mp4');
        const convertedFilePath = createTempFilePath(convertedFileName);

        try {
            // WhatsApp friendly settings: h.264 video, aac audio, moov atom at start
            await execAsync(`${ffmpeg} -i "${filePath}" -c:v libx264 -preset medium -crf 23 -c:a aac -b:a 128k -movflags +faststart "${convertedFilePath}" -y`);
            logger.info('✅ Video converted successfully');

            // Delete original file to save space
            try {
                fs.unlinkSync(filePath);
            } catch (unlinkError: unknown) {
                const errorMessage = unlinkError instanceof Error ? unlinkError.message : String(unlinkError);
                logger.warn('⚠️ Could not delete original file:', errorMessage);
            }

            return {
                success: true,
                filePath: convertedFilePath,
                fileName: convertedFileName
            };
        } catch (convertError: unknown) {
            logger.error('❌ Video conversion failed:', convertError as Error);
            logger.warn('⚠️ Using original file without conversion');

            // Return original file as fallback
            return {
                success: false,
                fallback: true,
                filePath: filePath,
                fileName: fileName
            };
        }
    }
}

export default new VideoConverter();
