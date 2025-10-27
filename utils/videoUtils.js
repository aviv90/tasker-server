const { isErrorResult, getTaskError } = require('./errorHandler');
const taskStore = require('../store/taskStore');
const fs = require('fs');
const path = require('path');

async function finalizeVideo(taskId, result, prompt, req = null) {
  try {
    if (isErrorResult(result)) {
      await taskStore.set(taskId, getTaskError(result));
      return;
    }
    
    let videoURL = result.result; // expected URL from providers like replicate/gemini

    // Handle Gemini path: returns videoBuffer (no result URL yet)
    if (!videoURL && result.videoBuffer) {
      const filename = `${taskId}.mp4`;
      const outputDir = path.join(__dirname, '..', 'public', 'tmp');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
      const outputPath = path.join(outputDir, filename);
      fs.writeFileSync(outputPath, result.videoBuffer);
      videoURL = `/static/${filename}`;
    }
    
    // If videoBuffer exists but result also exists (Gemini case), save the buffer to the correct file
    if (result.videoBuffer && videoURL && videoURL.startsWith('/static/')) {
      const filename = path.basename(videoURL);
      const outputDir = path.join(__dirname, '..', 'public', 'tmp');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
      const outputPath = path.join(outputDir, filename);
      fs.writeFileSync(outputPath, result.videoBuffer);
    }
    
    // Handle cases where videoURL starts with /static/ and needs host prefix
    if (req && videoURL && videoURL.startsWith('/static/')) {
      const host = `${req.protocol}://${req.get('host')}`;
      videoURL = `${host}${videoURL}`;
    }
    
    await taskStore.set(taskId, {
      status:'done',
      result: videoURL,
      text: result.text || prompt,
      cost: result.cost
    });
  } catch (error) {
    console.error(`❌ Error in finalizeVideo:`, error);
    await taskStore.set(taskId, getTaskError(error, 'Failed to finalize video'));
  }
}

module.exports = { finalizeVideo };
