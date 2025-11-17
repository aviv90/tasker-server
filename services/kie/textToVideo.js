/**
 * Kie Service Text-to-Video Generation
 */

const { sanitizeText } = require('../../utils/textSanitizer');
const KieServiceBase = require('./base');
const { pollVideoGeneration, extractVideoUrls } = require('./polling');
const { downloadVideoFile } = require('./download');

class TextToVideoService extends KieServiceBase {
  /**
   * Generate video from text prompt
   */
  async generateVideoWithText(prompt, model = 'veo3') {
    try {
      console.log(`🎬 Starting Kie.ai ${model} text-to-video generation`);

      const cleanPrompt = sanitizeText(prompt);

      // Step 1: Submit video generation task
      const generateResponse = await fetch(`${this.baseUrl}/api/v1/veo/generate`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          prompt: cleanPrompt,
          model: model,
          aspectRatio: "16:9"
        })
      });

      const generateData = await generateResponse.json();

      if (!generateResponse.ok || generateData.code !== 200) {
        console.error(`❌ Kie.ai ${model} task submission failed:`, generateData.msg);
        return { error: generateData.msg || 'Task submission failed' };
      }

      const taskId = generateData.data.taskId;
      console.log(`✅ Kie.ai ${model} task submitted successfully. Task ID: ${taskId}`);

      // Step 2: Poll for completion
      const pollResult = await pollVideoGeneration(this.apiKey, this.baseUrl, taskId, model);

      if (pollResult.error) {
        return { error: pollResult.error };
      }

      // Step 3: Extract video URLs
      const responseData = pollResult.status.response;
      const urlResult = extractVideoUrls(responseData, model);

      if (urlResult.error) {
        return { error: urlResult.error };
      }

      const videoUrl = urlResult.videoUrls[0];

      // Step 4: Download the video
      const downloadResult = await downloadVideoFile(videoUrl, model);

      if (downloadResult.error) {
        return { error: downloadResult.error };
      }

      console.log(`✅ Kie.ai ${model} text-to-video generated successfully.`);

      return {
        text: cleanPrompt,
        videoBuffer: downloadResult.videoBuffer,
        result: downloadResult.result
      };

    } catch (err) {
      console.error(`❌ Kie.ai ${model} text-to-video generation error:`, err);
      return { error: err.message || 'Unknown error' };
    }
  }
}

module.exports = TextToVideoService;

