/**
 * Kie Service Image-to-Video Generation
 */

import { sanitizeText } from '../../utils/textSanitizer';
import { getStaticFileUrl } from '../../utils/urlUtils';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { KieServiceBase } from './base';
import { pollVideoGeneration, extractVideoUrls } from './polling';
import { downloadVideoFile } from './download';
import { createTempFilePath, cleanupTempFile } from '../../utils/tempFileUtils';

/**
 * Image-to-video result
 */
interface ImageToVideoResult {
  text?: string;
  videoBuffer?: Buffer;
  result?: string;
  error?: string;
}

class ImageToVideoService extends KieServiceBase {
  /**
   * Generate video from image and text prompt
   */
  async generateVideoWithImage(prompt: string, imageBuffer: Buffer, model = 'veo3'): Promise<ImageToVideoResult> {
    try {
      console.log(`🎬 Starting Kie.ai ${model} image-to-video generation`);

      const cleanPrompt = sanitizeText(prompt);

      // Step 1: Upload image first (save temporarily and create public URL)
      const tempImageName = `temp_image_${uuidv4()}.png`;
      const tempImagePath = createTempFilePath(tempImageName);
      fs.writeFileSync(tempImagePath, imageBuffer);

      // Create public URL for the image
      const imageUrl = getStaticFileUrl(`tmp/${tempImageName}`, null);

      // Step 2: Submit video generation task with image
      const generateResponse = await fetch(`${this.baseUrl}/api/v1/veo/generate`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          prompt: cleanPrompt,
          imageUrls: [imageUrl],
          model: model,
          aspectRatio: "16:9"
        })
      });

      const generateData = await generateResponse.json() as {
        code?: number;
        msg?: string;
        data?: {
          taskId?: string;
        };
      };

      if (!generateResponse.ok || generateData.code !== 200) {
        console.error(`❌ Kie.ai ${model} image-to-video task submission failed:`, generateData.msg);
        // Clean up temp image
        cleanupTempFile(tempImagePath);
        return { error: generateData.msg || 'Task submission failed' };
      }

      const taskId = generateData.data?.taskId;
      if (!taskId) {
        cleanupTempFile(tempImagePath);
        return { error: 'No task ID received' };
      }

      console.log(`✅ Kie.ai ${model} image-to-video task submitted successfully. Task ID: ${taskId}`);

      // Step 3: Poll for completion
      const pollResult = await pollVideoGeneration(this.apiKey, this.baseUrl, taskId, model);

      if (pollResult.error) {
        // Clean up temp image
        cleanupTempFile(tempImagePath);
        return { error: pollResult.error };
      }

      // Step 4: Extract video URLs
      const responseData = pollResult.status?.response;
      if (!responseData) {
        cleanupTempFile(tempImagePath);
        return { error: 'No response data in poll result' };
      }

      const urlResult = extractVideoUrls(responseData, model);

      if (urlResult.error) {
        // Clean up temp image
        cleanupTempFile(tempImagePath);
        return { error: urlResult.error };
      }

      const videoUrl = urlResult.videoUrls?.[0];
      if (!videoUrl) {
        cleanupTempFile(tempImagePath);
        return { error: 'No video URL found' };
      }

      // Step 5: Download and process video
      const downloadResult = await downloadVideoFile(videoUrl, model);

      // Clean up temp image (regardless of download result)
      cleanupTempFile(tempImagePath);

      if (downloadResult.error) {
        return { error: downloadResult.error };
      }

      console.log(`✅ Kie.ai ${model} image-to-video generated successfully.`);

      return {
        text: cleanPrompt,
        videoBuffer: downloadResult.videoBuffer,
        result: downloadResult.result
      };

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error(`❌ Kie.ai ${model} image-to-video generation error:`, err);
      return { error: errorMessage };
    }
  }
}

export default ImageToVideoService;

