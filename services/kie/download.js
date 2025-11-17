/**
 * Kie Service Download Logic
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/**
 * Download video from URL and save to temp file
 */
async function downloadVideoFile(videoUrl, model) {
  console.log(`✅ Kie.ai ${model} video generation completed! Downloading...`);

  const tempFileName = `temp_video_${uuidv4()}.mp4`;
  const tempFilePath = path.join(__dirname, '../..', 'public', 'tmp', tempFileName);
  const tmpDir = path.dirname(tempFilePath);

  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  try {
    const videoResponse = await fetch(videoUrl);
    if (!videoResponse.ok) {
      throw new Error(`Failed to download video: HTTP ${videoResponse.status}`);
    }

    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
    fs.writeFileSync(tempFilePath, videoBuffer);

    // Verify file was written correctly
    let retries = 0;
    let fileReady = false;

    while (!fileReady && retries < 15) {
      await new Promise(resolve => setTimeout(resolve, 200));

      if (fs.existsSync(tempFilePath)) {
        try {
          const stats = fs.statSync(tempFilePath);

          if (stats.size > 0) {
            await new Promise(resolve => setTimeout(resolve, 500));
            const newStats = fs.statSync(tempFilePath);

            if (newStats.size === stats.size && stats.size > 10000) { // At least 10KB
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

    const finalVideoBuffer = fs.readFileSync(tempFilePath);
    const filename = path.basename(tempFilePath);
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

