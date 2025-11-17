const { sanitizeText } = require('../../utils/textSanitizer');
const { getApiUrl } = require('../../utils/urlUtils');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const { getStaticFileUrl } = require('../../utils/urlUtils');

/**
 * Music generation operations
 */
class MusicGeneration {
  constructor(musicService) {
    this.musicService = musicService;
  }

  async generateMusicWithLyrics(prompt, options = {}) {
    try {
      console.log(`🎵 Starting Suno music generation with lyrics`);
      
      const cleanPrompt = sanitizeText(prompt);
      
      // Basic mode - compatible with existing API, enhanced with V5
      const musicOptions = {
        prompt: cleanPrompt,
        customMode: false, // Let Suno be creative
        instrumental: false, // We want lyrics
        model: options.model || 'V5', // Use V5 for latest and best quality
        callBackUrl: getApiUrl('/api/music/callback')
      };
      
      // Only add advanced parameters if they are explicitly provided
      if (options.style) musicOptions.style = options.style;
      if (options.title) musicOptions.title = options.title;
      if (options.tags && Array.isArray(options.tags)) musicOptions.tags = options.tags;
      if (options.duration) musicOptions.duration = options.duration;
      
      console.log(`🎼 Using automatic mode`);

      // Step 1: Submit music generation task
      const generateResponse = await fetch(`${this.musicService.baseUrl}/api/v1/generate`, {
        method: 'POST',
        headers: this.musicService.headers,
        body: JSON.stringify(musicOptions)
      });

      const generateData = await generateResponse.json();
      
      if (!generateResponse.ok || generateData.code !== 200) {
        console.error(`❌ Suno music generation task submission failed:`, generateData.msg);
        return { error: generateData.msg || 'Music generation task submission failed' };
      }

      const taskId = generateData.data.taskId;
      console.log(`✅ Suno music generation task submitted successfully. Task ID: ${taskId}`);

      console.log(`📞 Waiting for callback notification instead of polling...`);

      // Store task info for callback handling
      const taskInfo = {
        taskId: taskId,
        type: 'with-lyrics',
        musicOptions: musicOptions,
        timestamp: Date.now(),
        // Store WhatsApp context for callback delivery
        whatsappContext: options.whatsappContext || null,
        // Store if video was requested (for separate video generation after music completes)
        wantsVideo: options.makeVideo === true
      };

      // Store in a simple in-memory map (in production, use Redis or database)
      if (!this.musicService.pendingTasks) {
        this.musicService.pendingTasks = new Map();
      }
      this.musicService.pendingTasks.set(taskId, taskInfo);

      // Return immediately - callback will handle completion
      return {
        taskId: taskId,
        status: 'pending',
        message: '🎵 יצירת השיר החלה! ממתין להשלמה...'
      };

    } catch (err) {
      console.error(`❌ Suno music generation error:`, err);
      return { error: err.message || 'Unknown error' };
    }
  }

  async generateInstrumentalMusic(prompt, options = {}) {
    try {
      console.log(`🎼 Starting Suno instrumental music generation`);
      
      const cleanPrompt = sanitizeText(prompt);
      
      // Basic instrumental mode - compatible with existing API, enhanced with V5
      const musicOptions = {
        prompt: cleanPrompt,
        customMode: false, // Let Suno be creative  
        instrumental: true, // No lyrics
        model: options.model || 'V5', // Use V5 for latest and best quality
        callBackUrl: getApiUrl('/api/music/callback')
      };
      
      // Only add advanced parameters if they are explicitly provided
      if (options.style) musicOptions.style = options.style;
      if (options.title) musicOptions.title = options.title;
      if (options.tags && Array.isArray(options.tags)) musicOptions.tags = options.tags;
      if (options.duration) musicOptions.duration = options.duration;

      console.log(`🎹 Using automatic instrumental mode`);

      // Use the same logic as generateMusicWithLyrics but with instrumental settings
      return await this._generateMusic(musicOptions, 'instrumental');

    } catch (err) {
      console.error(`❌ Suno instrumental music generation error:`, err);
      return { error: err.message || 'Unknown error' };
    }
  }

  async _generateMusic(musicOptions, type = 'with-lyrics') {
    // Submit generation task
    const generateResponse = await fetch(`${this.musicService.baseUrl}/api/v1/generate`, {
      method: 'POST',
      headers: this.musicService.headers,
      body: JSON.stringify(musicOptions)
    });

    const generateData = await generateResponse.json();
    
    if (!generateResponse.ok || generateData.code !== 200) {
      console.error(`❌ Suno ${type} music task submission failed:`, generateData.msg);
      return { error: generateData.msg || `${type} music generation task submission failed` };
    }

    const taskId = generateData.data.taskId;
    console.log(`✅ Suno ${type} music task submitted successfully. Task ID: ${taskId}`);

    console.log(`📞 Waiting for callback notification instead of polling...`);

    // Store task info for callback handling
    const taskInfo = {
      taskId: taskId,
      type: type,
      musicOptions: musicOptions,
      timestamp: Date.now()
    };

    // Store in a simple in-memory map (in production, use Redis or database)
    if (!this.musicService.pendingTasks) {
      this.musicService.pendingTasks = new Map();
    }
    this.musicService.pendingTasks.set(taskId, taskInfo);

    // Return immediately - callback will handle completion
    return {
      taskId: taskId,
      status: 'pending',
      message: `🎵 יצירת ${type} החלה! ממתין להשלמה...`
    };
  }

  async generateAdvancedMusic(prompt, options = {}) {
    try {
      console.log(`🎵 Starting Suno V5 advanced music generation`);
      
      const cleanPrompt = sanitizeText(prompt);
      
      // Enhanced music styles for V5
      const musicStyles = [
        'Pop', 'Rock', 'Jazz', 'Classical', 'Electronic', 'Hip-Hop',
        'Country', 'Folk', 'R&B', 'Reggae', 'Blues', 'Indie',
        'Alternative', 'Soul', 'Funk', 'Dance', 'Acoustic', 'Lo-fi',
        'Ambient', 'Cinematic', 'World', 'Experimental', 'Synthwave', 'Chill'
      ];
      
      const randomStyle = musicStyles[Math.floor(Math.random() * musicStyles.length)];
      
      // Generate title from prompt
      const generateTitle = (prompt) => {
        const words = prompt.split(' ').slice(0, 4).join(' ');
        const suffixes = ['Song', 'Melody', 'Tune', 'Beat', 'Rhythm', 'Vibe', 'Sound'];
        const randomSuffix = suffixes[Math.floor(Math.random() * suffixes.length)];
        return `${words} ${randomSuffix}`.substring(0, 80);
      };
      
      // Advanced V5 configuration with full control
      const musicOptions = {
        prompt: cleanPrompt,
        customMode: options.customMode || true, // Use custom mode for advanced control
        instrumental: options.instrumental || false,
        model: options.model || 'V5', // Always use V5 for advanced features
        callBackUrl: getApiUrl('/api/music/callback'),
        // V5 advanced parameters
        style: options.style || randomStyle,
        title: options.title || generateTitle(cleanPrompt),
        tags: options.tags || [randomStyle.toLowerCase()],
        duration: options.duration || 60, // V5 supports longer tracks
        genre: options.genre || randomStyle.toLowerCase(),
        mood: options.mood || 'upbeat',
        tempo: options.tempo || 'medium',
        // Advanced V5 features
        instruments: options.instruments || [],
        vocalStyle: options.vocalStyle || 'natural',
        language: options.language || 'english',
        key: options.key || 'C major',
        timeSignature: options.timeSignature || '4/4',
        // Quality settings for V5
        quality: options.quality || 'high',
        stereo: options.stereo !== false, // Default to stereo
        sampleRate: options.sampleRate || 44100
      };
      
      console.log(`🎼 Using advanced V5 mode`);

      // Use the same generation logic but with advanced options
      return await this._generateMusic(musicOptions, 'advanced');

    } catch (err) {
      console.error(`❌ Suno V5 advanced music generation error:`, err);
      return { error: err.message || 'Unknown error' };
    }
  }

  async generateSongFromSpeech(audioBuffer, options = {}) {
    try {
      console.log(`🎤 Starting Speech-to-Song generation with Add Instrumental API`);
      
      // Step 1: Upload audio file and get public URL
      const uploadResult = await this._uploadAudioFile(audioBuffer);
      if (uploadResult.error) {
        return { error: `Audio upload failed: ${uploadResult.error}` };
      }

      // Test if upload URL is accessible externally
      console.log(`🌐 Testing external accessibility: ${uploadResult.uploadUrl}`);
      try {
        const testResponse = await fetch(uploadResult.uploadUrl, { 
          method: 'HEAD',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; KieAI-Test/1.0)'
          }
        });
        console.log(`🌐 External access test: ${testResponse.status} ${testResponse.statusText}`);
      } catch (testError) {
        console.error(`❌ Upload URL accessibility test failed:`, testError.message);
      }

      // Step 2: Try Upload-Extend API with speech-friendly parameters
      const extendOptions = {
        uploadUrl: uploadResult.uploadUrl,
        defaultParamFlag: false, // Use default parameters to preserve original audio better
        prompt: options.prompt || 'Add very gentle background music while keeping the original speech clear and audible',
        callBackUrl: uploadResult.callbackUrl
      };

      console.log(`🎼 Using Upload-Extend API with speech preservation:`, extendOptions);

      return await this._generateExtend(extendOptions);
    } catch (err) {
      console.error('❌ Speech-to-Song generation error:', err);
      return { error: err.message || 'Unknown error' };
    }
  }

  async _generateExtend(extendOptions) {
    try {
      console.log(`🎼 Submitting Upload-Extend request`);
      
      // Submit upload-extend task
      const generateResponse = await fetch(`${this.musicService.baseUrl}/api/v1/generate/upload-extend`, {
        method: 'POST',
        headers: this.musicService.headers,
        body: JSON.stringify(extendOptions)
      });

      const generateData = await generateResponse.json();
      
      if (!generateResponse.ok || generateData.code !== 200) {
        console.error('❌ Upload-Extend API error:', generateData);
        return { error: generateData.message || 'Upload-Extend request failed' };
      }

      const taskId = generateData.data.taskId;
      console.log(`✅ Upload-Extend task submitted: ${taskId}`);

      console.log(`📞 Waiting for callback notification instead of polling...`);

      // Store task info for callback handling
      const taskInfo = {
        taskId: taskId,
        type: 'upload-extend',
        extendOptions: extendOptions,
        timestamp: Date.now()
      };

      // Store in a simple in-memory map (in production, use Redis or database)
      if (!this.musicService.pendingTasks) {
        this.musicService.pendingTasks = new Map();
      }
      this.musicService.pendingTasks.set(taskId, taskInfo);

      // Return immediately - callback will handle completion
      return {
        taskId: taskId,
        status: 'pending',
        message: '🎵 יצירת Upload-Extend החלה! ממתין להשלמה...'
      };
    } catch (err) {
      console.error('❌ Upload-Extend generation error:', err);
      return { error: err.message || 'Unknown error' };
    }
  }

  async _generateCover(coverOptions) {
    try {
      console.log(`🎼 Submitting Upload-Cover request`);
      
      // Submit upload-cover task
      const generateResponse = await fetch(`${this.musicService.baseUrl}/api/v1/generate/upload-cover`, {
        method: 'POST',
        headers: this.musicService.headers,
        body: JSON.stringify(coverOptions)
      });

      const generateData = await generateResponse.json();
      
      if (!generateResponse.ok || generateData.code !== 200) {
        console.error('❌ Upload-Cover API error:', generateData);
        return { error: generateData.message || 'Upload-Cover request failed' };
      }

      const taskId = generateData.data.taskId;
      console.log(`✅ Upload-Cover task submitted: ${taskId}`);

      console.log(`📞 Waiting for callback notification instead of polling...`);

      // Store task info for callback handling
      const taskInfo = {
        taskId: taskId,
        type: 'upload-cover',
        coverOptions: coverOptions,
        timestamp: Date.now()
      };

      // Store in a simple in-memory map (in production, use Redis or database)
      if (!this.musicService.pendingTasks) {
        this.musicService.pendingTasks = new Map();
      }
      this.musicService.pendingTasks.set(taskId, taskInfo);

      // Return immediately - callback will handle completion
      return {
        taskId: taskId,
        status: 'pending',
        message: '🎵 יצירת Upload-Cover החלה! ממתין להשלמה...'
      };
    } catch (err) {
      console.error('❌ Upload-Cover generation error:', err);
      return { error: err.message || 'Unknown error' };
    }
  }

  async _uploadAudioFile(audioBuffer) {
    try {
      const filename = `speech_${uuidv4()}.mp3`; // Keep .mp3 extension for compatibility
      const tempFilePath = path.join(__dirname, '..', '..', 'public', 'tmp', filename);
      const outputDir = path.dirname(tempFilePath);
      
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      // Save audio file temporarily
      fs.writeFileSync(tempFilePath, audioBuffer);
      
      // Verify file was written correctly
      const fileStats = fs.statSync(tempFilePath);
      console.log(`💾 Audio file saved: ${filename}, size: ${fileStats.size} bytes`);
      
      // Create public URL for the uploaded file
      const uploadUrl = getStaticFileUrl(filename);
      const callbackUrl = this._getCallbackUrl();
      
      console.log(`✅ Audio file uploaded: ${uploadUrl}`);
      
      return { uploadUrl, callbackUrl };
    } catch (error) {
      console.error('❌ Audio upload error:', error);
      return { error: error.message || 'Audio upload failed' };
    }
  }

  async _generateInstrumental(instrumentalOptions) {
    try {
      console.log(`🎼 Submitting Add Instrumental request`);
      
      // Submit add-instrumental task
      const generateResponse = await fetch(`${this.musicService.baseUrl}/api/v1/generate/add-instrumental`, {
        method: 'POST',
        headers: this.musicService.headers,
        body: JSON.stringify(instrumentalOptions)
      });

      const generateData = await generateResponse.json();
      
      if (!generateResponse.ok || generateData.code !== 200) {
        console.error('❌ Add Instrumental API error:', generateData);
        return { error: generateData.message || 'Add Instrumental request failed' };
      }

      const taskId = generateData.data.taskId;
      console.log(`✅ Add Instrumental task submitted: ${taskId}`);

      console.log(`📞 Waiting for callback notification instead of polling...`);

      // Store task info for callback handling
      const taskInfo = {
        taskId: taskId,
        type: 'add-instrumental',
        instrumentalOptions: instrumentalOptions,
        timestamp: Date.now()
      };

      // Store in a simple in-memory map (in production, use Redis or database)
      if (!this.musicService.pendingTasks) {
        this.musicService.pendingTasks = new Map();
      }
      this.musicService.pendingTasks.set(taskId, taskInfo);

      // Return immediately - callback will handle completion
      return {
        taskId: taskId,
        status: 'pending',
        message: '🎵 יצירת Add Instrumental החלה! ממתין להשלמה...'
      };
    } catch (err) {
      console.error('❌ Add Instrumental generation error:', err);
      return { error: err.message || 'Unknown error' };
    }
  }

  _getCallbackUrl() {
    return getApiUrl('/api/music/callback');
  }
}

module.exports = MusicGeneration;

