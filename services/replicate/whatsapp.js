const Replicate = require('replicate');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const MODELS = require('./models');
const helpers = require('./helpers');
const { getStaticFileUrl } = require('../../utils/urlUtils');

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_KEY,
});

/**
 * Replicate WhatsApp-specific video generation operations
 */
class ReplicateWhatsApp {
  /**
   * Download and save video for WhatsApp
   */
  async downloadAndSaveVideo(videoUrl, fileName, req) {
    const filePath = path.join(__dirname, '../..', 'public', 'tmp', fileName);

    const tmpDir = path.dirname(filePath);
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    // Download video from Replicate URL
    const videoResponse = await axios.get(videoUrl, {
      responseType: 'arraybuffer'
    });

    // Write video file
    fs.writeFileSync(filePath, videoResponse.data);

    // Create public URL using centralized URL utility
    const publicVideoUrl = getStaticFileUrl(fileName, req);

    console.log(`🎬 Video saved to: ${filePath}`);
    console.log(`🔗 Public URL: ${publicVideoUrl}`);

    return publicVideoUrl;
  }

  /**
   * Generate video from image for WhatsApp
   */
  async generateVideoFromImageForWhatsApp(imageBuffer, prompt, req = null) {
    try {
      console.log('🎬 Starting Kling v2.1 Master image-to-video generation');

      const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

      // Kling v2.1 Master parameters for WhatsApp (9:16 format)
      const input = {
        start_image: base64Image,
        prompt: prompt || "animate this image with smooth motion",
        duration: 5,
        aspect_ratio: "9:16"
      };

      const prediction = await replicate.predictions.create({
        version: MODELS.IMAGE_TO_VIDEO,
        input: input
      });

      if (!prediction?.id) {
        return {
          success: false,
          error: 'No prediction ID received from Replicate'
        };
      }

      console.log('🔄 Polling for completion');

      const maxAttempts = 80; // Kling can take longer
      const pollResult = await helpers.pollPrediction(replicate, prediction.id, maxAttempts, 'image-to-video generation');

      if (!pollResult.success) {
        console.error('❌ Kling v2.1 Master image-to-video generation failed:', pollResult.error);
        return {
          success: false,
          error: pollResult.error
        };
      }

      console.log('✅ Kling v2.1 Master image-to-video generation completed');

      const videoURL = helpers.extractVideoUrl(pollResult.result.output);

      const videoId = uuidv4();
      const fileName = `kling_image_video_${videoId}.mp4`;
      const videoUrl = await this.downloadAndSaveVideo(videoURL, fileName, req);

      console.log('✅ Kling v2.1 Master image-to-video generated successfully');

      return {
        success: true,
        videoUrl: videoUrl,
        description: prompt || "וידאו נוצר מתמונה",
        fileName: fileName
      };

    } catch (err) {
      console.error('❌ Kling v2.1 Master image-to-video generation error:', err);
      return {
        success: false,
        error: err.message || 'Unknown error occurred during image-to-video generation'
      };
    }
  }

  /**
   * Generate video from video for WhatsApp
   */
  async generateVideoFromVideoForWhatsApp(videoBuffer, prompt, req = null) {
    try {
      console.log('🎬 Starting RunwayML Gen4 video-to-video generation');

      // Create temporary file for video processing
      const tempDir = path.join(__dirname, '../..', 'public', 'tmp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempVideoPath = path.join(tempDir, `temp_video_${Date.now()}.mp4`);
      fs.writeFileSync(tempVideoPath, videoBuffer);

      const videoBase64 = fs.readFileSync(tempVideoPath).toString('base64');
      const videoDataUrl = `data:video/mp4;base64,${videoBase64}`;

      const input = {
        prompt: prompt || "enhance and transform this video",
        video: videoDataUrl,
        aspect_ratio: "9:16"
      };

      console.log('🔄 Calling RunwayML Gen4 API');
      const output = await replicate.run(MODELS.VIDEO_TO_VIDEO, { input });

      // Clean up temp file
      try {
        fs.unlinkSync(tempVideoPath);
      } catch (cleanupError) {
        console.warn('Could not clean up temp file:', cleanupError.message);
      }

      if (!output) {
        return {
          success: false,
          error: 'No output received from RunwayML Gen4'
        };
      }

      // Handle different response types
      let videoURL = null;

      // Handle ReadableStream response
      if (output && typeof output.getReader === 'function') {
        console.log('🔄 Converting ReadableStream to file');

        const reader = output.getReader();
        const chunks = [];

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }

          const processedVideoBuffer = Buffer.concat(chunks);
          const outputFilename = `runway_video_${Date.now()}.mp4`;
          const outputPath = path.join(tempDir, outputFilename);

          fs.writeFileSync(outputPath, processedVideoBuffer);

          videoURL = getStaticFileUrl(outputFilename, req);

          console.log('✅ RunwayML Gen4 video-to-video completed');

        } catch (streamError) {
          return {
            success: false,
            error: `Failed to read video stream: ${streamError.message}`
          };
        }
      } else {
        // Handle direct URL response
        videoURL = helpers.extractVideoUrl(output);
        console.log('✅ RunwayML Gen4 video-to-video completed');
      }

      if (!videoURL) {
        return {
          success: false,
          error: 'No video URL received from RunwayML Gen4'
        };
      }

      // If URL is external, download and save it
      if (videoURL.startsWith('http') && !videoURL.includes(req?.get('host'))) {
        const fileName = `runway_video_${Date.now()}.mp4`;
        videoURL = await this.downloadAndSaveVideo(videoURL, fileName, req);
      }

      return {
        success: true,
        videoUrl: videoURL,
        description: prompt || "וידאו עובד מחדש",
        fileName: `runway_video_${Date.now()}.mp4`
      };

    } catch (err) {
      console.error('❌ RunwayML Gen4 video-to-video generation error:', err);
      return {
        success: false,
        error: err.message || 'Unknown error occurred during video-to-video generation'
      };
    }
  }

  /**
   * Generate video from text for WhatsApp
   */
  async generateVideoWithTextForWhatsApp(prompt, req = null) {
    try {
      console.log('🎬 Starting Kling v2.1 Master text-to-video generation');

      // Use Kling v2.1 Master with mobile-optimized settings
      const inputParams = {
        prompt: prompt,
        aspect_ratio: "9:16",
        duration: 5,
        negative_prompt: ""
      };

      const prediction = await replicate.predictions.create({
        version: MODELS.TEXT_TO_VIDEO,
        input: inputParams
      });

      if (!prediction?.id) {
        return {
          success: false,
          error: 'No prediction ID received from Replicate'
        };
      }

      console.log('🔄 Polling for Kling text-to-video completion');

      const maxAttempts = 80; // Kling can take longer
      const pollResult = await helpers.pollPrediction(replicate, prediction.id, maxAttempts, 'Kling text-to-video');

      if (!pollResult.success) {
        return {
          success: false,
          error: pollResult.error
        };
      }

      console.log('✅ Kling text-to-video completed');

      const videoURL = helpers.extractVideoUrl(pollResult.result.output);

      return {
        success: true,
        videoUrl: videoURL,
        description: prompt,
        fileName: `kling_video_${Date.now()}.mp4`
      };

    } catch (err) {
      console.error('❌ Kling text-to-video generation error:', err);
      return {
        success: false,
        error: err.message || 'Unknown error occurred during text-to-video generation'
      };
    }
  }
}

module.exports = new ReplicateWhatsApp();

