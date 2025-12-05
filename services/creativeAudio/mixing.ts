/**
 * Creative Audio Mixing
 * 
 * Handles audio mixing with background music and creative voice processing
 */

import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { promisify } from 'util';
import { getTempDir, ensureTempDir, cleanupTempFile } from '../../utils/tempFileUtils';
import { getRandomEffect, applyCreativeEffect } from './effects';
import {
  getRandomBackground,
  getRandomInstrumentalStyle,
  generateBackgroundMusic,
  generateSunoInstrumental
} from './background';
import logger from '../../utils/logger';
import ffmpegStatic from 'ffmpeg-static';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AUDIO } = require('../../utils/constants');

const execAsync = promisify(exec);

interface MixedAudio {
  success: boolean;
  audioBuffer?: Buffer;
  size?: number;
}

interface ProcessedVoice extends MixedAudio {
  effect?: string;
  background?: string;
  description?: string;
  error?: string;
}

/**
 * Mix voice with background music
 * @param {Buffer} voiceBuffer - Voice audio buffer
 * @param {string} voiceFormat - Voice format
 * @param {string} backgroundPath - Background music file path
 * @returns {Promise<Object>} Result with mixed audio
 */
export async function mixWithBackground(voiceBuffer: Buffer, voiceFormat: string = 'mp3', backgroundPath: string): Promise<MixedAudio> {
  const tempDir = getTempDir();
  ensureTempDir();

  const voiceFileName = `voice_${uuidv4()}.${voiceFormat}`;
  const backgroundLowFileName = `bg_low_${uuidv4()}.mp3`;
  const outputFileName = `mixed_${uuidv4()}.mp3`;
  const voicePath = path.join(tempDir, voiceFileName);
  const backgroundLowPath = path.join(tempDir, backgroundLowFileName);
  const outputPath = path.join(tempDir, outputFileName);

  try {
    // Write voice buffer to temporary file
    fs.writeFileSync(voicePath, voiceBuffer);

    logger.debug(`🎵 Mixing voice with background music...`);

    // Step 1: Lower background music volume to make it subtle background
    const ffmpegBin = ffmpegStatic || 'ffmpeg';
    const volumeCommand = [
      ffmpegBin,
      '-i', backgroundPath,
      '-filter:a', 'volume=0.3',
      '-c:a', 'libmp3lame',
      '-b:a', '128k',
      '-y',
      backgroundLowPath
    ].join(' ');

    logger.debug(`🔊 Lowering background volume: ${volumeCommand}`);

    await execAsync(volumeCommand);

    if (!fs.existsSync(backgroundLowPath)) {
      throw new Error('Background volume adjustment failed');
    }

    // Step 2: Mix voice with lowered background (voice louder, music quieter)
    const mixCommand = `${ffmpegBin} -i "${voicePath}" -i "${backgroundLowPath}" -filter_complex "[0:a]volume=1.2[voice];[1:a]volume=0.3[bg];[voice][bg]amix=inputs=2:duration=first" -c:a libmp3lame -b:a 128k -y "${outputPath}"`;

    logger.debug(`🎵 Mixing command: ${mixCommand}`);

    await execAsync(mixCommand);

    if (!fs.existsSync(outputPath)) {
      throw new Error('Mixed file was not created');
    }

    const mixedBuffer = fs.readFileSync(outputPath);

    // Clean up temporary files
    cleanupTempFile(voicePath);
    cleanupTempFile(backgroundLowPath);
    cleanupTempFile(outputPath);

    logger.debug(`✅ Voice mixed with background: ${mixedBuffer.length} bytes`);

    return {
      success: true,
      audioBuffer: mixedBuffer,
      size: mixedBuffer.length
    };

  } catch (err: unknown) {
    const error = err as Error;
    logger.error('❌ Error in audio mixing:', { error: error.message || String(err), stack: error.stack });

    // Clean up temporary files
    cleanupTempFile(voicePath);
    cleanupTempFile(backgroundLowPath);
    cleanupTempFile(outputPath);

    throw new Error(`Audio mixing failed: ${error.message}`);
  }
}

/**
 * Process voice message with random creative effects
 * @param {Buffer} audioBuffer - Input audio buffer
 * @param {string} inputFormat - Input format
 * @returns {Promise<Object>} Result with processed audio
 */
export async function processVoiceCreatively(audioBuffer: Buffer, inputFormat: string = 'mp3'): Promise<ProcessedVoice> {
  try {
    logger.debug(`🎨 Starting creative voice processing...`);

    // Get random effect
    const effect = getRandomEffect();
    logger.debug(`🎲 Selected effect: ${effect.name}`);

    // Apply creative effect
    const effectResult = await applyCreativeEffect(audioBuffer, inputFormat, effect);

    if (!effectResult.success || !effectResult.audioBuffer) {
      throw new Error('Creative effect failed');
    }

    // Always add background music
    logger.debug(`🎵 Adding background music...`);

    // Get audio duration (approximate)
    const duration = Math.max(AUDIO.MIN_DURATION_ESTIMATE, Math.min(AUDIO.MAX_DURATION_ESTIMATE, audioBuffer.length / AUDIO.BYTES_PER_SECOND_ESTIMATE)); // Rough estimate

    // Choose background music type: 50% synthetic, 50% Suno
    const backgroundType = Math.random();
    let backgroundPath;
    let backgroundName;

    logger.debug(`🎲 Background: ${backgroundType < 0.5 ? 'Synthetic' : 'Suno'}`);

    if (backgroundType < 0.5) {
      // Synthetic background music (50%)
      const background = getRandomBackground();
      logger.debug(`🎲 Selected synthetic background: ${background.name}`);
      backgroundPath = await generateBackgroundMusic(duration, background.key);
      backgroundName = background.name;
    } else {
      // Suno instrumental music (50%)
      const instrumentalStyle = getRandomInstrumentalStyle();

      if (!instrumentalStyle) {
        // Fallback if no style found
        logger.warn(`⚠️ No instrumental style found, using default`);
        const background = getRandomBackground();
        backgroundPath = await generateBackgroundMusic(duration, background.key);
        backgroundName = background.name;
      } else {
        logger.debug(`🎲 Selected Suno instrumental: ${instrumentalStyle.name}`);

        try {
          backgroundPath = await generateSunoInstrumental(duration, instrumentalStyle);
          backgroundName = instrumentalStyle.name;
          logger.debug(`✅ Suno instrumental path: ${backgroundPath}`);
        } catch (sunoError: any) {
          logger.warn(`⚠️ Suno instrumental failed, falling back to synthetic:`, { error: sunoError.message });
          // Fallback to synthetic background music
          const background = getRandomBackground();
          logger.debug(`🎲 Fallback to synthetic background: ${background.name}`);
          backgroundPath = await generateBackgroundMusic(duration, background.key);
          backgroundName = `${background.name} (fallback)`;
        }
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

  } catch (err: any) {
    logger.error('❌ Error in creative voice processing:', { error: err.message || String(err), stack: err.stack });
    return {
      success: false,
      error: err.message || 'Creative processing failed'
    };
  }
}
