const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const taskStore = require('../../store/taskStore');
const geminiService = require('../../services/geminiService');
const openaiService = require('../../services/openai');
const { validateAndSanitizePrompt } = require('../../utils/textSanitizer');
const { getTaskError } = require('../../utils/errorHandler');
const finalizers = require('./finalizers');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    fieldSize: 50 * 1024 * 1024
  }
});

/**
 * Image upload routes
 */
class ImageUploadRoutes {
  /**
   * Setup image upload routes
   */
  setupRoutes(router) {
    /**
     * Upload and edit image
     */
    router.post('/upload-edit', upload.single('file'), async (req, res) => {
      const { prompt, provider } = req.body;

      // Validate required fields
      if (!prompt || !req.file) {
        return res.status(400).json({
          status: 'error',
          error: 'Missing prompt or file'
        });
      }

      // Validate and sanitize prompt
      let sanitizedPrompt;
      try {
        sanitizedPrompt = validateAndSanitizePrompt(prompt);
      } catch (validationError) {
        return res.status(400).json({
          status: 'error',
          error: validationError.message
        });
      }

      const taskId = uuidv4();
      await taskStore.set(taskId, { status: 'pending' });
      res.json({ taskId });

      try {
        let result;
        if (provider === 'openai') {
          result = await openaiService.editImageWithText(sanitizedPrompt, req.file.buffer);
        } else if (provider === 'gemini') {
          const base64 = req.file.buffer.toString('base64');
          result = await geminiService.editImageWithText(sanitizedPrompt, base64);
        } else {
          // Default to openai for image editing
          result = await openaiService.editImageWithText(sanitizedPrompt, req.file.buffer);
        }

        await finalizers.finalize(taskId, result, req);
      } catch (error) {
        console.error(`❌ Image edit error:`, error);
        await taskStore.set(taskId, getTaskError(error));
      }
    });
  }
}

module.exports = new ImageUploadRoutes();

