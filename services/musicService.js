const MusicGeneration = require('./music/generation');
const MusicCallbacks = require('./music/callbacks');
const MusicVideo = require('./music/video');
const MusicWhatsAppDelivery = require('./music/whatsappDelivery');

class MusicService {
  constructor() {
    this.apiKey = process.env.KIE_API_KEY;
    this.baseUrl = 'https://api.kie.ai';
    this.headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    };
    
    // Initialize managers
    this.generationManager = new MusicGeneration(this);
    this.callbacksManager = new MusicCallbacks(this);
    this.videoManager = new MusicVideo(this);
    this.whatsappDelivery = new MusicWhatsAppDelivery();
    
    // Task tracking maps
    this.pendingTasks = new Map();
    this.pendingVideoTasks = new Map();
  }

  // ═══════════════════ GENERATION ═══════════════════

  async generateMusicWithLyrics(prompt, options = {}) {
    return this.generationManager.generateMusicWithLyrics(prompt, options);
  }

  async generateInstrumentalMusic(prompt, options = {}) {
    return this.generationManager.generateInstrumentalMusic(prompt, options);
  }

  async generateAdvancedMusic(prompt, options = {}) {
    return this.generationManager.generateAdvancedMusic(prompt, options);
  }

  async generateSongFromSpeech(audioBuffer, options = {}) {
    return this.generationManager.generateSongFromSpeech(audioBuffer, options);
  }

  // ═══════════════════ CALLBACKS ═══════════════════

  async handleCallbackCompletion(taskId, callbackData) {
    return this.callbacksManager.handleCallbackCompletion(taskId, callbackData);
  }

  // ═══════════════════ VIDEO ═══════════════════

  async generateMusicVideo(musicTaskId, audioId, options = {}) {
    return this.videoManager.generateMusicVideo(musicTaskId, audioId, options);
  }

  async handleVideoCallbackCompletion(videoTaskId, callbackData) {
    return this.videoManager.handleVideoCallbackCompletion(videoTaskId, callbackData);
  }

  async convertVideoForWhatsApp(inputPath, outputPath) {
    return this.videoManager.convertVideoForWhatsApp(inputPath, outputPath);
  }

  // ═══════════════════ WHATSAPP DELIVERY ═══════════════════

  async sendMusicToWhatsApp(whatsappContext, musicResult) {
    return this.whatsappDelivery.sendMusicToWhatsApp(whatsappContext, musicResult);
  }
}

// Create and export instance
const musicService = new MusicService();

module.exports = {
  generateMusicWithLyrics: musicService.generateMusicWithLyrics.bind(musicService),
  generateInstrumentalMusic: musicService.generateInstrumentalMusic.bind(musicService),
  generateAdvancedMusic: musicService.generateAdvancedMusic.bind(musicService),
  generateSongFromSpeech: musicService.generateSongFromSpeech.bind(musicService),
  handleCallbackCompletion: musicService.handleCallbackCompletion.bind(musicService),
  generateMusicVideo: musicService.generateMusicVideo.bind(musicService),
  handleVideoCallbackCompletion: musicService.handleVideoCallbackCompletion.bind(musicService),
  sendMusicToWhatsApp: musicService.sendMusicToWhatsApp.bind(musicService)
};
