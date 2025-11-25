/**
 * Creative Audio Effects
 * 
 * Handles creative audio effects library and application
 */

import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { promisify } from 'util';
import { getTempDir, ensureTempDir, cleanupTempFile } from '../../utils/tempFileUtils';

const execAsync = promisify(exec);

export interface Effect {
  name: string;
  command: string;
}

/**
 * Creative effects library
 */
export const EFFECTS: Record<string, Effect> = {
  // Voice effects
  robot: {
    name: '🤖 Robot Voice',
    command: '-filter:a "atempo=0.8,asetrate=44100*0.8,volume=1.2"'
  },
  chipmunk: {
    name: '🐿️ Chipmunk Voice',
    command: '-filter:a "atempo=1.5,asetrate=44100*1.5"'
  },
  deep: {
    name: '🎭 Deep Voice',
    command: '-filter:a "atempo=0.7,asetrate=44100*0.7"'
  },
  radio: {
    name: '📻 Radio Effect',
    command: '-filter:a "highpass=f=300,lowpass=f=3000,volume=0.8"'
  },
  telephone: {
    name: '📞 Telephone Effect',
    command: '-filter:a "highpass=f=300,lowpass=f=3400,volume=0.7"'
  },
  echo: {
    name: '🔊 Echo Effect',
    command: '-filter:a "aecho=0.8:0.9:1000:0.3"'
  },
  reverb: {
    name: '🏛️ Reverb Effect',
    command: '-filter:a "aecho=0.8:0.9:1000:0.3,volume=0.9"'
  },
  distortion: {
    name: '🎸 Distortion',
    command: '-filter:a "volume=2.0,acompressor=threshold=0.1:ratio=9:attack=200:release=1000"'
  },
  chorus: {
    name: '🎵 Chorus Effect',
    command: '-filter:a "chorus=0.5:0.9:50:0.4:0.25:2"'
  },
  flanger: {
    name: '🌊 Flanger Effect',
    command: '-filter:a "flanger=delay=10:depth=2:regen=0:width=71:speed=0.5"'
  },
  // Pitch effects (standard FFmpeg)
  pitch_up: {
    name: '🎼 Pitch Up',
    command: '-filter:a "asetrate=44100*2^(4/12),atempo=1/2^(4/12),aresample=44100"'
  },
  pitch_down: {
    name: '🎼 Pitch Down',
    command: '-filter:a "asetrate=44100*2^(-4/12),atempo=1/2^(-4/12),aresample=44100"'
  },
  vibrato: {
    name: '🎵 Vibrato',
    command: '-filter:a "vibrato=f=5.0:d=0.5"'
  },
  tremolo: {
    name: '🎵 Tremolo',
    command: '-filter:a "tremolo=f=5.0:d=0.5"'
  },
  phaser: {
    name: '🌀 Phaser',
    command: '-filter:a "aphaser=in_gain=0.4:out_gain=0.74:delay=3.0:decay=0.4:speed=0.5"'
  },
  compressor: {
    name: '🎚️ Compressor',
    command: '-filter:a "acompressor=threshold=0.089:ratio=9:attack=200:release=1000"'
  },
  stereo_wide: {
    name: '🎧 Stereo Wide',
    command: '-filter:a "stereowiden"'
  },
  // Additional creative effects
  reverse: {
    name: '⏪ Reverse',
    command: '-filter:a "areverse"'
  },
  fade_in: {
    name: '🌅 Fade In',
    command: '-filter:a "afade=t=in:st=0:d=2.0"'
  },
  fade_out: {
    name: '🌇 Fade Out',
    command: '-filter:a "afade=t=out:st=0:d=2.0"'
  },
  bass_boost: {
    name: '🔊 Bass Boost',
    command: '-filter:a "bass=g=5:f=100"'
  },
  treble_boost: {
    name: '🔊 Treble Boost',
    command: '-filter:a "treble=g=5:f=3000"'
  },
  noise_reduction: {
    name: '🔇 Noise Reduction',
    command: '-filter:a "afftdn=nf=-25"'
  },
  equalizer: {
    name: '🎛️ Equalizer',
    command: '-filter:a "highpass=f=200,lowpass=f=3000"'
  },
  slow_motion: {
    name: '🐌 Slow Motion',
    command: '-filter:a "atempo=0.5"'
  },
  fast_forward: {
    name: '⚡ Fast Forward',
    command: '-filter:a "atempo=2.0"'
  },
  underwater: {
    name: '🌊 Underwater',
    command: '-filter:a "highpass=f=200,lowpass=f=2000,volume=0.8"'
  },
  space_echo: {
    name: '🚀 Space Echo',
    command: '-filter:a "aecho=0.8:0.9:2000:0.5"'
  }
};

interface EffectWithKey extends Effect {
  key: string;
}

interface ProcessedAudio {
  success: boolean;
  audioBuffer?: Buffer;
  size?: number;
  effect?: string;
  error?: string;
}

/**
 * Get random creative effect
 * @returns {Object} Random effect configuration
 */
export function getRandomEffect(): EffectWithKey {
  const effectKeys = Object.keys(EFFECTS);
  if (effectKeys.length === 0) throw new Error("No effects defined");
  const randomKey = effectKeys[Math.floor(Math.random() * effectKeys.length)];
  if (!randomKey) throw new Error("Failed to select random effect");
  
  const effect = EFFECTS[randomKey];
  if (!effect) throw new Error(`Effect not found for key: ${randomKey}`);

  return {
    key: randomKey,
    ...effect
  };
}

/**
 * Apply creative effect to audio
 * @param {Buffer} audioBuffer - Input audio buffer
 * @param {string} inputFormat - Input format
 * @param {Object} effect - Effect configuration
 * @returns {Promise<Object>} Result with processed audio
 */
export async function applyCreativeEffect(audioBuffer: Buffer, inputFormat: string = 'mp3', effect: Effect): Promise<ProcessedAudio> {
  return new Promise(async (resolve, reject) => {
    try {
      const tempDir = getTempDir();
      ensureTempDir();

      const inputFileName = `input_${uuidv4()}.${inputFormat}`;
      const outputFileName = `creative_${uuidv4()}.mp3`;
      const inputPath = path.join(tempDir, inputFileName);
      const outputPath = path.join(tempDir, outputFileName);

      // Write input audio buffer to temporary file
      fs.writeFileSync(inputPath, audioBuffer);

      console.log(`🎨 Applying creative effect: ${effect.name}`);

      // FFmpeg command for creative effect
      const ffmpegCommand = [
        'ffmpeg',
        '-i', inputPath,
        effect.command,
        '-c:a', 'libmp3lame',
        '-b:a', '128k',
        '-y', // Overwrite output file
        outputPath
      ].join(' ');

      console.log(`🎵 FFmpeg command: ${ffmpegCommand}`);

      try {
        const { stderr } = await execAsync(ffmpegCommand);

        if (stderr && stderr.includes('error')) {
          throw new Error(`FFmpeg error: ${stderr}`);
        }

        // Read the processed audio file
        if (!fs.existsSync(outputPath)) {
          throw new Error('Output file was not created');
        }

        const processedBuffer = fs.readFileSync(outputPath);

        // Clean up temporary files
        cleanupTempFile(inputPath);
        cleanupTempFile(outputPath);

        console.log(`✅ Creative effect applied: ${processedBuffer.length} bytes`);

        resolve({
          success: true,
          audioBuffer: processedBuffer,
          size: processedBuffer.length,
          effect: effect.name
        });

      } catch (ffmpegError: any) {
        console.error('❌ FFmpeg processing error:', ffmpegError);

        // Clean up temporary files
        cleanupTempFile(inputPath);
        cleanupTempFile(outputPath);

        reject(new Error(`Creative processing failed: ${ffmpegError.message}`));
      }

    } catch (err: any) {
      console.error('❌ Error in creative effect setup:', err);
      reject(new Error(`Creative setup failed: ${err.message}`));
    }
  });
}
