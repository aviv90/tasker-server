/**
 * Kie Service Download Logic
 */

const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { createTempFilePath, verifyFileWritten } = require('../../utils/tempFileUtils');

/**
 * Download video from URL and save to temp file
 */
async function downloadVideoFile(videoUrl, model) {
  console.log(`✅ Kie.ai ${model} video generation completed! Downloading...`);

  const tempFileName = `temp_video_${uuidv4()}.mp4`;
  const tempFilePath = createTempFilePath(tempFileName);

  try {
    const videoResponse = await fetch(videoUrl);
    if (!videoResponse.ok) {
      throw new Error(`Failed to download video: HTTP ${videoResponse.status}`);
    }

    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
    fs.writeFileSync(tempFilePath, videoBuffer);

    // Verify file was written correctly
    const verifyResult = await verifyFileWritten(tempFilePath, 10000, 15);

    if (!verifyResult.success) {
      console.error('❌ Video file was not properly downloaded');
      return { error: verifyResult.error || 'Video file was not downloaded successfully' };
    }

    const finalVideoBuffer = fs.readFileSync(tempFilePath);
    const filename = require('path').basename(tempFilePath);
    const publicPath = `/static/${filename}`;

    return {
      videoBuffer: finalVideoBuffer,
      result: publicPath
    };

  } catch (downloadError) {
    console.error(`❌ Kie.ai ${model} video download failed:`, downloadError);
    return { error: `Video download failed: ${downloadError.message}` };
  }
}

module.exports = {
  downloadVideoFile
};

