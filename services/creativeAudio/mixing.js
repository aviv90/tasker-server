/**
 * Creative Audio Mixing
 * 
 * Handles audio mixing with background music and creative voice processing
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { promisify } = require('util');
const { getTempDir, ensureTempDir, cleanupTempFile } = require('../../utils/tempFileUtils');
const { getRandomEffect, applyCreativeEffect } = require('./effects');
const {
  getRandomBackground,
  getRandomInstrumentalStyle,
  generateBackgroundMusic,
  generateSunoInstrumental
} = require('./background');

const execAsync = promisify(exec);

/**
 * Mix voice with background music
 * @param {Buffer} voiceBuffer - Voice audio buffer
 * @param {string} voiceFormat - Voice format
 * @param {string} backgroundPath - Background music file path
 * @returns {Promise<Object>} Result with mixed audio
 */
async function mixWithBackground(voiceBuffer, voiceFormat = 'mp3', backgroundPath) {
  return new Promise(async (resolve, reject) => {
    try {
      const tempDir = getTempDir();
      ensureTempDir();

      const voiceFileName = `voice_${uuidv4()}.${voiceFormat}`;
      const backgroundLowFileName = `bg_low_${uuidv4()}.mp3`;
      const outputFileName = `mixed_${uuidv4()}.mp3`;
      const voicePath = path.join(tempDir, voiceFileName);
      const backgroundLowPath = path.join(tempDir, backgroundLowFileName);
      const outputPath = path.join(tempDir, outputFileName);

      // Write voice buffer to temporary file
      fs.writeFileSync(voicePath, voiceBuffer);

      console.log(`🎵 Mixing voice with background music...`);

      // Step 1: Lower background music volume to make it subtle background
      const volumeCommand = [
        'ffmpeg',
        '-i', backgroundPath,
        '-filter:a', 'volume=0.3',
        '-c:a', 'libmp3lame',
        '-b:a', '128k',
        '-y',
        backgroundLowPath
      ].join(' ');

      console.log(`🔊 Lowering background volume: ${volumeCommand}`);

      try {
        await execAsync(volumeCommand);

        if (!fs.existsSync(backgroundLowPath)) {
          throw new Error('Background volume adjustment failed');
        }

        // Step 2: Mix voice with lowered background (voice louder, music quieter)
        const mixCommand = `ffmpeg -i "${voicePath}" -i "${backgroundLowPath}" -filter_complex "[0:a]volume=1.2[voice];[1:a]volume=0.3[bg];[voice][bg]amix=inputs=2:duration=first" -c:a libmp3lame -b:a 128k -y "${outputPath}"`;

        console.log(`🎵 Mixing command: ${mixCommand}`);

        await execAsync(mixCommand);

        if (!fs.existsSync(outputPath)) {
          throw new Error('Mixed file was not created');
        }

        const mixedBuffer = fs.readFileSync(outputPath);

        // Clean up temporary files
        cleanupTempFile(voicePath);
        cleanupTempFile(backgroundLowPath);
        cleanupTempFile(outputPath);

        console.log(`✅ Voice mixed with background: ${mixedBuffer.length} bytes`);

        resolve({
          success: true,
          audioBuffer: mixedBuffer,
          size: mixedBuffer.length
        });

      } catch (ffmpegError) {
        console.error('❌ FFmpeg mixing error:', ffmpegError);

        // Clean up temporary files
        cleanupTempFile(voicePath);
        cleanupTempFile(backgroundLowPath);
        cleanupTempFile(outputPath);

        reject(new Error(`Audio mixing failed: ${ffmpegError.message}`));
      }

    } catch (err) {
      console.error('❌ Error in audio mixing setup:', err);
      reject(new Error(`Mixing setup failed: ${err.message}`));
    }
  });
}

/**
 * Process voice message with random creative effects
 * @param {Buffer} audioBuffer - Input audio buffer
 * @param {string} inputFormat - Input format
 * @returns {Promise<Object>} Result with processed audio
 */
async function processVoiceCreatively(audioBuffer, inputFormat = 'mp3') {
  try {
    console.log(`🎨 Starting creative voice processing...`);

    // Get random effect
    const effect = getRandomEffect();
    console.log(`🎲 Selected effect: ${effect.name}`);

    // Apply creative effect
    const effectResult = await applyCreativeEffect(audioBuffer, inputFormat, effect);

    if (!effectResult.success) {
      throw new Error('Creative effect failed');
    }

    // Always add background music
    console.log(`🎵 Adding background music...`);

    // Get audio duration (approximate)
    const duration = Math.max(3, Math.min(15, audioBuffer.length / 10000)); // Rough estimate

    // Choose background music type: 50% synthetic, 50% Suno
    const backgroundType = Math.random();
    let backgroundPath;
    let backgroundName;

    console.log(`🎲 Background: ${backgroundType < 0.5 ? 'Synthetic' : 'Suno'}`);

    if (backgroundType < 0.5) {
      // Synthetic background music (50%)
      const background = getRandomBackground();
      console.log(`🎲 Selected synthetic background: ${background.name}`);
      backgroundPath = await generateBackgroundMusic(duration, background.key);
      backgroundName = background.name;
    } else {
      // Suno instrumental music (50%)
      const instrumentalStyle = getRandomInstrumentalStyle();
      console.log(`🎲 Selected Suno instrumental: ${instrumentalStyle.name}`);

      try {
        backgroundPath = await generateSunoInstrumental(duration, instrumentalStyle);
        backgroundName = instrumentalStyle.name;
        console.log(`✅ Suno instrumental path: ${backgroundPath}`);
      } catch (sunoError) {
        console.warn(`⚠️ Suno instrumental failed, falling back to synthetic: ${sunoError.message}`);
        // Fallback to synthetic background music
        const background = getRandomBackground();
        console.log(`🎲 Fallback to synthetic background: ${background.name}`);
        backgroundPath = await generateBackgroundMusic(duration, background.key);
        backgroundName = `${background.name} (fallback)`;
      }
    }

    // Mix voice with background
    const mixResult = await mixWithBackground(effectResult.audioBuffer, 'mp3', backgroundPath);

    // Clean up background music file
    cleanupTempFile(backgroundPath);

    if (mixResult.success) {
      return {
        success: true,
        audioBuffer: mixResult.audioBuffer,
        size: mixResult.size,
        effect: effect.name,
        background: backgroundName,
        description: `Applied ${effect.name} + ${backgroundName}`
      };
    }

    // Return just the effect result if mixing failed
    return {
      success: true,
      audioBuffer: effectResult.audioBuffer,
      size: effectResult.size,
      effect: effect.name,
      description: `Applied ${effect.name}`
    };

  } catch (err) {
    console.error('❌ Error in creative voice processing:', err);
    return {
      success: false,
      error: err.message || 'Creative processing failed'
    };
  }
}

module.exports = {
  mixWithBackground,
  processVoiceCreatively
};

