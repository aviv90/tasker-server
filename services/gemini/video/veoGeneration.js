const genai = require('@google/genai');
const { sanitizeText } = require('../../../utils/textSanitizer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const veoClient = new genai.GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

/**
 * Veo video generation operations
 */
class VeoGeneration {
  /**
   * Poll operation until completion
   */
  async pollOperation(operation, operationType = 'video generation') {
    console.log('⏳ Polling for video generation completion...');
    const maxWaitTime = 10 * 60 * 1000; // 10 minutes
    const startTime = Date.now();
    let pollAttempts = 0;

    while (!operation.done) {
      if (Date.now() - startTime > maxWaitTime) {
        console.error(`❌ Veo 3 ${operationType} timed out`);
        return { error: `Video generation timed out after 10 minutes` };
      }
      await new Promise(resolve => setTimeout(resolve, 10000));
      pollAttempts++;
      console.log(`🔄 Polling attempt ${pollAttempts} for Veo 3 ${operationType}`);
      operation = await veoClient.operations.getVideosOperation({ operation });
    }

    return operation;
  }

  /**
   * Validate operation response
   */
  validateOperationResponse(operation) {
    if (!operation.response || !operation.response.generatedVideos ||
      !operation.response.generatedVideos.length ||
      !operation.response.generatedVideos[0] ||
      !operation.response.generatedVideos[0].video) {
      console.error('❌ Invalid Veo 3 response structure:', operation);

      let errorMessage = 'Invalid response from Veo 3 API';
      if (operation.response && operation.response.raiMediaFilteredReasons && operation.response.raiMediaFilteredReasons.length > 0) {
        errorMessage = operation.response.raiMediaFilteredReasons[0];
      }

      return { error: errorMessage };
    }

    return null;
  }

  /**
   * Download video file from Veo
   */
  async downloadVideoFile(videoFile, fileNamePrefix = 'temp') {
    const tempFileName = `${fileNamePrefix}_video_${uuidv4()}.mp4`;
    const tempFilePath = path.join(__dirname, '../../../..', 'public', 'tmp', tempFileName);
    const tmpDir = path.dirname(tempFilePath);

    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    try {
      await veoClient.files.download({ file: videoFile, downloadPath: tempFilePath });
      console.log('📥 SDK download completed');
    } catch (downloadError) {
      console.error('❌ SDK download failed:', downloadError);
      return { error: `Failed to download video file: ${downloadError.message}` };
    }

    return { filePath: tempFilePath, fileName: tempFileName };
  }

  /**
   * Wait for file to be ready
   */
  async waitForFileReady(filePath, minSize = 10000) {
    let retries = 0;
    let fileReady = false;

    while (!fileReady && retries < 15) {
      await new Promise(resolve => setTimeout(resolve, 200));

      if (fs.existsSync(filePath)) {
        try {
          const stats = fs.statSync(filePath);

          if (stats.size > 0) {
            await new Promise(resolve => setTimeout(resolve, 500));
            const newStats = fs.statSync(filePath);

            if (newStats.size === stats.size && stats.size > minSize) {
              fileReady = true;
              break;
            }
          }
        } catch (statError) {
          // Continue retrying
        }
      }
      retries++;
    }

    if (!fileReady) {
      console.error('❌ Video file was not properly downloaded');
      return { error: 'Video file was not downloaded successfully' };
    }

    return { success: true };
  }

  /**
   * Generate video from text prompt
   */
  async generateVideoWithText(prompt) {
    try {
      console.log('🎬 Starting Veo 3 text-to-video generation - Stable version');
      const cleanPrompt = sanitizeText(prompt);

      let operation = await veoClient.models.generateVideos({
        model: "veo-3.1-generate-preview",
        prompt: cleanPrompt,
        config: {
          aspectRatio: "9:16"
        }
      });

      const pollResult = await this.pollOperation(operation, 'text-to-video generation');
      if (pollResult.error) {
        return pollResult;
      }
      operation = pollResult;

      const validationError = this.validateOperationResponse(operation);
      if (validationError) {
        return validationError;
      }

      const videoFile = operation.response.generatedVideos[0].video;
      const downloadResult = await this.downloadVideoFile(videoFile, 'temp');
      if (downloadResult.error) {
        return downloadResult;
      }

      const { filePath, fileName } = downloadResult;
      const fileReadyResult = await this.waitForFileReady(filePath, 10000);
      if (fileReadyResult.error) {
        return fileReadyResult;
      }

      console.log('✅ Veo 3 text-to-video generated successfully.');

      const videoBuffer = fs.readFileSync(filePath);
      const filename = path.basename(filePath);
      const publicPath = `/static/${filename}`;

      return {
        text: cleanPrompt,
        videoBuffer: videoBuffer,
        result: publicPath
      };
    } catch (err) {
      console.error('❌ Veo 3 text-to-video generation error:', err);
      return { error: err.message || 'Unknown error' };
    }
  }

  /**
   * Generate video from image and text prompt
   */
  async generateVideoWithImage(prompt, imageBuffer) {
    try {
      console.log('🎬 Starting Veo 3 image-to-video generation');

      const cleanPrompt = sanitizeText(prompt);
      const imageBase64 = imageBuffer.toString('base64');

      let operation = await veoClient.models.generateVideos({
        model: "veo-3.1-generate-preview",
        prompt: cleanPrompt,
        image: {
          imageBytes: imageBase64,
          mimeType: "image/jpeg",
        },
        config: {
          aspectRatio: "9:16"
        }
      });

      const pollResult = await this.pollOperation(operation, 'image-to-video generation');
      if (pollResult.error) {
        return pollResult;
      }
      operation = pollResult;

      const validationError = this.validateOperationResponse(operation);
      if (validationError) {
        return validationError;
      }

      const videoFile = operation.response.generatedVideos[0].video;
      const downloadResult = await this.downloadVideoFile(videoFile, 'temp');
      if (downloadResult.error) {
        return downloadResult;
      }

      const { filePath, fileName } = downloadResult;
      const fileReadyResult = await this.waitForFileReady(filePath, 10000);
      if (fileReadyResult.error) {
        return fileReadyResult;
      }

      console.log('✅ Veo 3 image-to-video generated successfully.');

      const videoBuffer = fs.readFileSync(filePath);
      const filename = path.basename(filePath);
      const publicPath = `/static/${filename}`;

      return {
        text: cleanPrompt,
        videoBuffer: videoBuffer,
        result: publicPath
      };
    } catch (err) {
      console.error('❌ Veo 3 image-to-video generation error:', err);
      return { error: err.message || 'Unknown error' };
    }
  }
}

module.exports = new VeoGeneration();

