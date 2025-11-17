const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const taskStore = require('../../store/taskStore');
const geminiService = require('../../services/geminiService');
const replicateService = require('../../services/replicateService');
const kieService = require('../../services/kieService');
const { finalizeVideo } = require('../../utils/videoUtils');
const { getTaskError } = require('../../utils/errorHandler');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    fieldSize: 50 * 1024 * 1024
  }
});

/**
 * Video upload routes
 */
class VideoUploadRoutes {
  /**
   * Setup video upload routes
   */
  setupRoutes(router) {
    /**
     * Upload image and convert to video
     */
    router.post('/upload-video', upload.single('file'), async (req, res) => {
      const { prompt, provider, model } = req.body;
      if (!prompt || !req.file) {
        return res.status(400).json({ status: 'error', error: 'Missing prompt or file' });
      }

      const taskId = uuidv4();
      await taskStore.set(taskId, { status: 'pending' });
      res.json({ taskId });

      try {
        let result;
        if (provider === 'replicate') {
          result = await replicateService.generateVideoFromImage(req.file.buffer, prompt, model);
        } else if (provider === 'gemini') {
          result = await geminiService.generateVideoWithImage(prompt, req.file.buffer);
        } else if (provider === 'kie') {
          result = await kieService.generateVideoWithImage(prompt, req.file.buffer, model);
        } else {
          // Default to replicate for image-to-video generation
          result = await replicateService.generateVideoFromImage(req.file.buffer, prompt, model);
        }

        await finalizeVideo(taskId, result, prompt, req);
      } catch (error) {
        console.error(`❌ Image-to-video error:`, error);
        await taskStore.set(taskId, getTaskError(error));
      }
    });

    /**
     * Upload video and edit it
     */
    router.post('/upload-video-edit', upload.single('file'), async (req, res) => {
      const { prompt } = req.body;
      if (!prompt || !req.file) {
        return res.status(400).json({ status: 'error', error: 'Missing prompt or file' });
      }

      const taskId = uuidv4();
      await taskStore.set(taskId, { status: 'pending' });
      res.json({ taskId });

      try {
        const result = await replicateService.generateVideoFromVideo(req.file.buffer, prompt);
        await finalizeVideo(taskId, result, prompt, req);
      } catch (error) {
        console.error(`❌ Video-to-video error:`, error);
        await taskStore.set(taskId, getTaskError(error));
      }
    });
  }
}

module.exports = new VideoUploadRoutes();

