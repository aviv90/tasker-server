/**
 * Creative Audio Processing Service
 * 
 * Orchestrator for creative audio effects, background music, and mixing.
 * Refactored to use modular components (Phase P1-1)
 */

const { getTempDir, ensureTempDir } = require('../utils/tempFileUtils');
const { getRandomEffect, applyCreativeEffect } = require('./creativeAudio/effects');
const {
  getRandomBackground,
  getRandomInstrumentalStyle,
  generateBackgroundMusic,
  generateSunoInstrumental,
  handleSunoCallback
} = require('./creativeAudio/background');
const { mixWithBackground, processVoiceCreatively } = require('./creativeAudio/mixing');

/**
 * Creative Audio Processing Service
 * Handles creative audio effects and remixing using FFmpeg
 */
class CreativeAudioService {
  constructor() {
    this.tempDir = getTempDir();
    ensureTempDir();
  }

  // Delegate to effects module
  getRandomEffect() {
    return getRandomEffect();
  }

  applyCreativeEffect(audioBuffer, inputFormat = 'mp3', effect) {
    return applyCreativeEffect(audioBuffer, inputFormat, effect);
  }

  // Delegate to background module
  getRandomBackground() {
    return getRandomBackground();
  }

  getRandomInstrumentalStyle() {
    return getRandomInstrumentalStyle();
  }

  generateBackgroundMusic(duration, style = 'upbeat') {
    return generateBackgroundMusic(duration, style);
  }

  generateSunoInstrumental(duration, style) {
    return generateSunoInstrumental(duration, style);
  }

  handleSunoCallback(taskId, audioBuffer) {
    return handleSunoCallback(taskId, audioBuffer);
  }

  // Delegate to mixing module
  mixWithBackground(voiceBuffer, voiceFormat = 'mp3', backgroundPath) {
    return mixWithBackground(voiceBuffer, voiceFormat, backgroundPath);
  }

  processVoiceCreatively(audioBuffer, inputFormat = 'mp3') {
    return processVoiceCreatively(audioBuffer, inputFormat);
  }
}

// Create and export instance
const creativeAudioService = new CreativeAudioService();

module.exports = {
  creativeAudioService,
  CreativeAudioService
};
