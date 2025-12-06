import logger from './utils/logger';
import ffmpegStatic from 'ffmpeg-static';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function testFFmpeg() {
    logger.info('Testing ffmpeg-static...');
    logger.info(`ffmpegStatic path: ${ffmpegStatic}`);

    if (!ffmpegStatic) {
        logger.error('❌ ffmpeg-static returned null/undefined');
        process.exit(1);
    }

    try {
        const { stdout } = await execAsync(`${ffmpegStatic} -version`);
        logger.info('✅ ffmpeg execution successful');
        logger.info(`Output start: ${stdout.substring(0, 100)}`);
    } catch (error: any) {
        logger.error('❌ ffmpeg execution failed:', error.message);
        process.exit(1);
    }
}

testFFmpeg();
