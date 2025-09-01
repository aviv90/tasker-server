const { isErrorResult, getTaskError } = require('./errorHandler');
const taskStore = require('../store/taskStore');
const fs = require('fs');
const path = require('path');

function finalizeVideo(taskId, result, prompt, req = null) {
  try {
    if (isErrorResult(result)) {
      taskStore.set(taskId, getTaskError(result));
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
      if (req) {
        const host = `${req.protocol}://${req.get('host')}`;
        videoURL = `${host}${videoURL}`;
      }
    }
    
    // Handle cases where videoURL starts with /static/ and needs host prefix
    if (req && videoURL && videoURL.startsWith('/static/')) {
      const host = `${req.protocol}://${req.get('host')}`;
      videoURL = `${host}${videoURL}`;
    }
    
    taskStore.set(taskId, {
      status:'done',
      result: videoURL,
      text: result.text || prompt,
      cost: result.cost
    });
  } catch (error) {
    console.error(`❌ Error in finalizeVideo:`, error);
    taskStore.set(taskId, getTaskError(error, 'Failed to finalize video'));
  }
}

module.exports = { finalizeVideo };
