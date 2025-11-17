/**
 * Kie Service Image-to-Video Generation
 */

const { sanitizeText } = require('../../utils/textSanitizer');
const { getStaticFileUrl } = require('../../utils/urlUtils');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const KieServiceBase = require('./base');
const { pollVideoGeneration, extractVideoUrls } = require('./polling');
const { downloadVideoFile } = require('./download');

class ImageToVideoService extends KieServiceBase {
  /**
   * Generate video from image and text prompt
   */
  async generateVideoWithImage(prompt, imageBuffer, model = 'veo3') {
    try {
      console.log(`🎬 Starting Kie.ai ${model} image-to-video generation`);

      const cleanPrompt = sanitizeText(prompt);

      // Step 1: Upload image first (save temporarily and create public URL)
      const tempImageName = `temp_image_${uuidv4()}.png`;
      const tempImagePath = path.join(__dirname, '../..', 'public', 'tmp', tempImageName);
      const tmpDir = path.dirname(tempImagePath);

      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }

      fs.writeFileSync(tempImagePath, imageBuffer);

      // Create public URL for the image
      const imageUrl = getStaticFileUrl(`tmp/${tempImageName}`);

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

      const generateData = await generateResponse.json();

      if (!generateResponse.ok || generateData.code !== 200) {
        console.error(`❌ Kie.ai ${model} image-to-video task submission failed:`, generateData.msg);
        // Clean up temp image
        try { fs.unlinkSync(tempImagePath); } catch (e) { }
        return { error: generateData.msg || 'Task submission failed' };
      }

      const taskId = generateData.data.taskId;
      console.log(`✅ Kie.ai ${model} image-to-video task submitted successfully. Task ID: ${taskId}`);

      // Step 3: Poll for completion
      const pollResult = await pollVideoGeneration(this.apiKey, this.baseUrl, taskId, model);

      if (pollResult.error) {
        // Clean up temp image
        try { fs.unlinkSync(tempImagePath); } catch (e) { }
        return { error: pollResult.error };
      }

      // Step 4: Extract video URLs
      const responseData = pollResult.status.response;
      const urlResult = extractVideoUrls(responseData, model);

      if (urlResult.error) {
        // Clean up temp image
        try { fs.unlinkSync(tempImagePath); } catch (e) { }
        return { error: urlResult.error };
      }

      const videoUrl = urlResult.videoUrls[0];

      // Step 5: Download and process video
      const downloadResult = await downloadVideoFile(videoUrl, model);

      // Clean up temp image (regardless of download result)
      try { fs.unlinkSync(tempImagePath); } catch (e) { }

      if (downloadResult.error) {
        return { error: downloadResult.error };
      }

      console.log(`✅ Kie.ai ${model} image-to-video generated successfully.`);

      return {
        text: cleanPrompt,
        videoBuffer: downloadResult.videoBuffer,
        result: downloadResult.result
      };

    } catch (err) {
      console.error(`❌ Kie.ai ${model} image-to-video generation error:`, err);
      return { error: err.message || 'Unknown error' };
    }
  }
}

module.exports = ImageToVideoService;

