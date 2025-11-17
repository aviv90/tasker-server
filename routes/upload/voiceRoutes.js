const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const taskStore = require('../../store/taskStore');
const { voiceService } = require('../../services/voiceService');
const { isErrorResult, getTaskError } = require('../../utils/errorHandler');
const callbacks = require('./callbacks');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    fieldSize: 50 * 1024 * 1024
  }
});

/**
 * Voice routes
 */
class VoiceRoutes {
  /**
   * Setup voice routes
   */
  setupRoutes(router) {
    /**
     * Speech-to-Song endpoint
     */
    router.post('/speech-to-song', upload.single('file'), async (req, res) => {
      console.log(`🎤 Starting Speech-to-Song generation for task ${req.body.taskId || 'new'}`);

      // Validate required fields
      if (!req.file) {
        return res.status(400).json({
          status: 'error',
          error: 'Missing audio file'
        });
      }

      // Validate file format and size
      const supportedTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/ogg', 'audio/opus', 'audio/webm', 'audio/m4a', 'audio/aac'];
      const maxSize = 10 * 1024 * 1024; // 10MB
      const minSize = 10 * 1024; // 10KB

      console.log(`📁 File received: ${req.file.originalname}, type: ${req.file.mimetype}, size: ${Math.round(req.file.size / 1024)}KB`);

      if (!supportedTypes.includes(req.file.mimetype)) {
        return res.status(400).json({
          status: 'error',
          error: `Unsupported file type: ${req.file.mimetype}. Supported: MP3, WAV, OGG, OPUS, WebM, M4A, AAC`
        });
      }

      if (req.file.size > maxSize) {
        return res.status(400).json({
          status: 'error',
          error: `File too large: ${Math.round(req.file.size / 1024 / 1024)}MB. Max size: 10MB`
        });
      }

      if (req.file.size < minSize) {
        return res.status(400).json({
          status: 'error',
          error: `File too small: ${Math.round(req.file.size / 1024)}KB. Please upload at least a few seconds of clear speech.`
        });
      }

      const taskId = uuidv4();
      taskStore.set(taskId, { status: 'pending' });
      res.json({ taskId }); // Send response immediately

      try {
        const musicService = require('../../services/musicService');

        // Use original audio buffer directly (no conversion)
        const audioBuffer = req.file.buffer;
        const fileType = req.file.mimetype;

        console.log(`🎤 Using original audio format: ${fileType}, size: ${Math.round(audioBuffer.length / 1024)}KB`);

        // Extract options from request with optimized defaults
        const options = {
          title: req.body.title || 'Generated Song from Speech',
          style: req.body.style || 'original voice, subtle backing',
          vocalGender: req.body.vocalGender || (Math.random() > 0.5 ? 'm' : 'f'),
          styleWeight: req.body.styleWeight ? parseFloat(req.body.styleWeight) : undefined,
          audioWeight: req.body.audioWeight ? parseFloat(req.body.audioWeight) : undefined,
          weirdnessConstraint: req.body.weirdnessConstraint ? parseFloat(req.body.weirdnessConstraint) : undefined
        };

        console.log(`🎵 Starting speech-to-song generation`);
        console.log(`🎤 Using audio format: ${fileType}, size: ${Math.round(audioBuffer.length / 1024)}KB`);

        // Generate song from speech
        const result = await musicService.generateSongFromSpeech(audioBuffer, options);

        // Store the mapping between our task ID and Kie.ai task ID for callback handling
        const kieTaskMapping = callbacks.getKieTaskMapping();
        if (result.taskId) {
          kieTaskMapping.set(result.taskId, taskId);
          console.log(`🔗 Mapped Kie task ${result.taskId} to our task ${taskId}`);
        }

        if (isErrorResult(result)) {
          const errorMessage = getTaskError(result);
          console.error(`❌ Speech-to-Song generation failed for task ${taskId}:`, errorMessage);
          await taskStore.set(taskId, { status: 'failed', error: errorMessage });
        } else {
          console.log(`✅ Speech-to-Song generation completed for task ${taskId}`);

          // Extract the first song URL for simple response format
          let songUrl = null;
          if (result.songs && result.songs.length > 0) {
            songUrl = result.songs[0].audioUrl;
          }

          await taskStore.set(taskId, {
            status: 'done',
            result: songUrl || result,
            type: 'speech-to-song',
            timestamp: new Date().toISOString()
          });
        }

      } catch (error) {
        console.error(`❌ Speech-to-Song generation error for task ${taskId}:`, error);
        await taskStore.set(taskId, {
          status: 'failed',
          error: error.message || 'Speech-to-Song generation failed'
        });
      }
    });

    /**
     * Cleanup endpoint - delete all custom voices
     */
    router.post('/cleanup-voices', async (req, res) => {
      try {
        console.log('🧹 Starting voice cleanup...');

        const result = await voiceService.getVoices();
        if (result.error) {
          return res.status(500).json({ status: 'error', error: result.error });
        }

        const voices = result.voices || [];
        console.log(`Found ${voices.length} total voices`);

        // Filter only custom voices (not built-in ElevenLabs voices)
        const customVoices = voices.filter(voice =>
          voice.category === 'cloned' ||
          voice.category === 'premade' && voice.sharing?.status === 'private' ||
          voice.name?.startsWith('Voice_')
        );

        console.log(`Found ${customVoices.length} custom voices to delete`);

        let deletedCount = 0;
        let errors = [];

        for (const voice of customVoices) {
          try {
            const deleteResult = await voiceService.deleteVoice(voice.voice_id);
            if (deleteResult.error) {
              errors.push(`${voice.name}: ${deleteResult.error}`);
            } else {
              deletedCount++;
              console.log(`✅ Deleted voice: ${voice.name} (${voice.voice_id})`);
            }
          } catch (error) {
            errors.push(`${voice.name}: ${error.message}`);
          }
        }

        res.json({
          status: 'done',
          message: `Cleanup completed: ${deletedCount} voices deleted`,
          deleted: deletedCount,
          total: customVoices.length,
          errors: errors.length > 0 ? errors : undefined
        });

      } catch (error) {
        console.error('❌ Voice cleanup error:', error);
        res.status(500).json({
          status: 'error',
          error: error.message || 'Voice cleanup failed'
        });
      }
    });
  }
}

module.exports = new VoiceRoutes();

