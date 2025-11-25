import Replicate from 'replicate';
import fs from 'fs';
import path from 'path';
import { MODELS } from './models';
import helpers from './helpers';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_KEY,
});

/**
 * Input parameters for video generation
 */
interface InputParams {
  prompt?: string;
  image?: string;
  start_image?: string;
  duration?: number;
  aspect_ratio?: string;
  width?: number;
  height?: number;
  negative_prompt?: string;
  video?: string;
  [key: string]: unknown;
}

/**
 * Video generation result
 */
interface VideoGenerationResult {
  text?: string;
  result?: string;
  cost?: string;
  error?: string;
}

/**
 * Replicate video generation operations
 */
class ReplicateGeneration {
  /**
   * Build input parameters based on model type
   */
  buildInputParams(prompt: string, model: string, base64Image: string | null = null): InputParams {
    const isVeo3 = model === 'veo3';

    if (base64Image) {
      // Image-to-video
      let input: InputParams = {
        image: base64Image,
      };

      if (isVeo3) {
        input = {
          ...input,
          duration: 8,
          aspect_ratio: "16:9"
        };
      } else {
        input = {
          start_image: base64Image,
          duration: 5,
          aspect_ratio: "9:16"
        };
        delete input.image;
      }

      if (prompt) {
        input.prompt = prompt;
      } else if (!isVeo3) {
        input.prompt = "animate this image with smooth motion";
      }

      return input;
    } else {
      // Text-to-video
      let inputParams: InputParams = {
        prompt: prompt,
      };

      if (isVeo3) {
        inputParams = {
          ...inputParams,
          duration: 8,
          width: 1920,
          height: 1080,
          aspect_ratio: "16:9"
        };
      } else {
        inputParams = {
          ...inputParams,
          aspect_ratio: "9:16",
          duration: 5,
          negative_prompt: ""
        };
      }

      return inputParams;
    }
  }

  /**
   * Generate video from text prompt
   */
  async generateVideoWithText(prompt: string, model = 'kling'): Promise<VideoGenerationResult> {
    try {
      const isVeo3 = model === 'veo3';
      const modelName = isVeo3 ? 'Veo 3' : 'Kling v2.1 Master';
      const modelVersion = isVeo3 ? MODELS.VEO3_TEXT_TO_VIDEO : MODELS.TEXT_TO_VIDEO;

      console.log(`🎬 Starting ${modelName} text-to-video generation`);

      const inputParams = this.buildInputParams(prompt, model);

      const prediction = await replicate.predictions.create({
        version: modelVersion,
        input: inputParams
      });

      if (!prediction?.id) {
        return { error: 'No prediction ID received from Replicate' };
      }

      console.log('🔄 Polling for completion');

      const maxAttempts = isVeo3 ? 60 : 80;
      const pollResult = await helpers.pollPrediction(replicate, prediction.id, maxAttempts, 'text-to-video generation');

      if (!pollResult.success) {
        return { error: pollResult.error };
      }

      console.log('✅ Text-to-video completed');

      const videoURL = helpers.extractVideoUrl(pollResult.result?.output);

      return {
        text: prompt,
        result: videoURL,
        cost: helpers.calculateCost(pollResult.result, isVeo3)
      };

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('❌ Text-to-video generation error:', errorMessage);
      return { error: helpers.extractErrorDetails(err) };
    }
  }

  /**
   * Generate video from image and text prompt
   */
  async generateVideoFromImage(imageBuffer: Buffer, prompt: string | null = null, model = 'kling'): Promise<VideoGenerationResult> {
    try {
      const isVeo3 = model === 'veo3';
      const modelName = isVeo3 ? 'Veo 3' : 'Kling v2.1 Master';
      const modelVersion = isVeo3 ? MODELS.VEO3_IMAGE_TO_VIDEO : MODELS.IMAGE_TO_VIDEO;

      console.log(`🎬 Starting ${modelName} image-to-video generation`);

      const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
      const input = this.buildInputParams(prompt || '', model, base64Image);

      const prediction = await replicate.predictions.create({
        version: modelVersion,
        input: input
      });

      if (!prediction?.id) {
        return { error: 'No prediction ID received from Replicate' };
      }

      console.log('🔄 Polling for completion');

      const maxAttempts = isVeo3 ? 60 : 80;
      const pollResult = await helpers.pollPrediction(replicate, prediction.id, maxAttempts, 'image-to-video generation');

      if (!pollResult.success) {
        return { error: pollResult.error };
      }

      console.log('✅ Image-to-video completed');

      const videoURL = helpers.extractVideoUrl(pollResult.result?.output);

      return {
        text: prompt || 'Image to video conversion',
        result: videoURL,
        cost: helpers.calculateCost(pollResult.result, isVeo3)
      };

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('❌ Image-to-video generation error:', errorMessage);
      return { error: helpers.extractErrorDetails(err) };
    }
  }

  /**
   * Generate video from video and text prompt
   */
  async generateVideoFromVideo(inputVideoBuffer: Buffer, prompt: string): Promise<{ result?: string; error?: string }> {
    try {
      console.log('🎬 Starting video-to-video generation');

      const tempDir = path.join(__dirname, '../..', 'public', 'tmp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempVideoPath = path.join(tempDir, `temp_video_${Date.now()}.mp4`);
      fs.writeFileSync(tempVideoPath, inputVideoBuffer);

      const videoBase64 = fs.readFileSync(tempVideoPath).toString('base64');
      const videoDataUrl = `data:video/mp4;base64,${videoBase64}`;

      const input = {
        prompt: prompt,
        video: videoDataUrl,
        aspect_ratio: "16:9"
      };

      console.log('🔄 Calling Replicate API');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const output = await replicate.run(MODELS.VIDEO_TO_VIDEO, { input }) as any;

      // Clean up temp file
      try {
        fs.unlinkSync(tempVideoPath);
      } catch (cleanupError: unknown) {
        const errorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        console.warn('Could not clean up temp file:', errorMessage);
      }

      if (!output) {
        throw new Error('No output received from Replicate');
      }

      // Handle ReadableStream response
      if (output && typeof output.getReader === 'function') {
        console.log('🔄 Converting ReadableStream to file');

        const reader = output.getReader();
        const chunks: Uint8Array[] = [];

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
            }
          }

          const videoBuffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
          const outputFilename = `video_${Date.now()}.mp4`;
          const outputDir = path.join(__dirname, '../..', 'public', 'tmp');
          const outputPath = path.join(outputDir, outputFilename);

          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }

          fs.writeFileSync(outputPath, videoBuffer);
          console.log('✅ Video-to-video completed');

          return { result: `/static/${outputFilename}` };

        } catch (streamError: unknown) {
          const errorMessage = streamError instanceof Error ? streamError.message : String(streamError);
          throw new Error(`Failed to read video stream: ${errorMessage}`);
        }
      } else {
        // Handle direct URL response
        const videoURL = helpers.extractVideoUrl(output);
        return { result: videoURL };
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ Video-to-video generation error:', errorMessage);
      throw error;
    }
  }
}

export default new ReplicateGeneration();

