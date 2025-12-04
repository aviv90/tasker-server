
import ffmpegStatic from 'ffmpeg-static';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function testFFmpeg() {
    console.log('Testing ffmpeg-static...');
    console.log(`ffmpegStatic path: ${ffmpegStatic}`);

    if (!ffmpegStatic) {
        console.error('❌ ffmpeg-static returned null/undefined');
        process.exit(1);
    }

    try {
        const { stdout } = await execAsync(`${ffmpegStatic} -version`);
        console.log('✅ ffmpeg execution successful');
        console.log('Output start:', stdout.substring(0, 100));
    } catch (error: any) {
        console.error('❌ ffmpeg execution failed:', error.message);
        process.exit(1);
    }
}

testFFmpeg();
