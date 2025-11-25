import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import ffprobePath from 'ffprobe-static';

const execAsync = promisify(exec);
const ffprobe = ffprobePath.path;

/**
 * Get audio duration via ffprobe
 * @param audioBuffer Audio buffer (`Buffer`)
 * @returns Duration in seconds
 */
export async function getAudioDuration(audioBuffer: Buffer): Promise<number> {
  try {
    const tempFilePath = path.join(os.tmpdir(), `agent_audio_check_${Date.now()}.ogg`);
    fs.writeFileSync(tempFilePath, audioBuffer);

    try {
      const { stdout } = await execAsync(
        `${ffprobe} -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tempFilePath}"`
      );
      const duration = parseFloat(stdout.trim());
      fs.unlinkSync(tempFilePath);
      console.log(`⏱️ [Agent] Audio duration: ${duration.toFixed(2)} seconds`);
      return duration;
    } catch (err) {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      const error = err as Error;
      console.error(`❌ [Agent] Could not get audio duration: ${error.message}`);
      return 0;
    }
  } catch (err) {
    const error = err as Error;
    console.error(`❌ [Agent] Error in getAudioDuration: ${error.message}`);
    return 0;
  }
}

module.exports = {
  getAudioDuration
};

