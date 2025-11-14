/**
 * Audio Utility Functions
 * Helper functions for audio processing
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { exec } = require('child_process');

const execAsync = promisify(exec);

/**
 * Get audio duration via ffprobe
 * @param {Buffer} audioBuffer - Audio buffer
 * @returns {Promise<number>} - Duration in seconds
 */
async function getAudioDuration(audioBuffer) {
  try {
    const tempFilePath = path.join(os.tmpdir(), `agent_audio_check_${Date.now()}.ogg`);
    fs.writeFileSync(tempFilePath, audioBuffer);

    try {
      const { stdout } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tempFilePath}"`
      );
      const duration = parseFloat(stdout.trim());
      fs.unlinkSync(tempFilePath);
      console.log(`⏱️ [Agent] Audio duration: ${duration.toFixed(2)} seconds`);
      return duration;
    } catch (err) {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      console.error(`❌ [Agent] Could not get audio duration: ${err.message}`);
      return 0;
    }
  } catch (err) {
    console.error(`❌ [Agent] Error in getAudioDuration: ${err.message}`);
    return 0;
  }
}

module.exports = {
  getAudioDuration
};

