const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer();
const { v4: uuidv4 } = require('uuid');
const taskStore = require('../store/taskStore');
const geminiService = require('../services/geminiService');
const replicateService = require('../services/replicateService');
const lemonfoxService = require('../services/lemonfoxService');
const fs = require('fs');
const path = require('path');

router.post('/upload-edit', upload.single('file'), async (req, res) => {
  const prompt = req.body.prompt;
  if (!prompt || !req.file) return res.status(400).json({ status:'error', error:'Missing prompt or file' });

  const taskId = uuidv4();
  taskStore.set(taskId, { status:'pending' });
  res.json({ taskId });

  const base64 = req.file.buffer.toString('base64');
  const result = await geminiService.editImageWithText(prompt, base64);
  finalize(taskId, result, req);
});

router.post('/upload-video', upload.single('file'), async (req, res) => {
  const { prompt, provider } = req.body;
  if (!prompt || !req.file) {
    console.log('❌ Upload video: Missing prompt or file');
    return res.status(400).json({ status:'error', error:'Missing prompt or file' });
  }

  const taskId = uuidv4();
  console.log(`🎬 Starting image-to-video with ${provider || 'Gemini'} - TaskID: ${taskId}`);
  taskStore.set(taskId, { status:'pending' });
  res.json({ taskId });

  let result;
  if (provider === 'replicate') {
    // For Replicate, use image-to-video service (imageBuffer, prompt order)
    result = await replicateService.generateVideoFromImage(req.file.buffer, prompt);
  } else {
    // For Gemini (default), use the new generateVideoWithImage function (prompt, imageBuffer order)
    result = await geminiService.generateVideoWithImage(prompt, req.file.buffer);
  }
  
  finalizeVideo(taskId, result, prompt, req);
});

router.post('/upload-video-edit', upload.single('file'), async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || !req.file) {
    return res.status(400).json({ status:'error', error:'Missing prompt or file' });
  }

  const taskId = uuidv4();
  console.log(`🎬 Starting video-to-video edit - TaskID: ${taskId}`);
  taskStore.set(taskId, { status:'pending' });
  res.json({ taskId });

  try {
    const result = await replicateService.generateVideoFromVideo(req.file.buffer, prompt);
    await finalizeVideo(taskId, result, prompt, req);
  } catch (error) {
    console.error(`❌ Video-to-video error:`, error);
    taskStore.set(taskId, { status: 'error', error: error.message || error.toString() });
  }
});

router.post('/upload-transcribe', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ status:'error', error:'Missing audio file' });
  }

  const taskId = uuidv4();
  console.log(`🎤 Starting audio transcription - TaskID: ${taskId}`);
  taskStore.set(taskId, { status:'pending' });
  res.json({ taskId });

  try {
    const filename = req.file.originalname || 'audio.wav';
    const result = await lemonfoxService.transcribeAudio(req.file.buffer, filename);
    await finalizeTranscription(taskId, result);
  } catch (error) {
    console.error(`❌ Transcription error:`, error);
    taskStore.set(taskId, { status: 'error', error: error.message || error.toString() });
  }
});

function finalizeVideo(taskId, result, prompt, req = null) {
  try {
    if (!result || result.error) {
      console.log(`❌ Image-to-video failed - TaskID: ${taskId}`);
      taskStore.set(taskId, { status:'error', ...result });
      return;
    }
    
    let outResult = result.result || result.videoURL; // Handle both replicate (videoURL) and other providers

    // Handle Gemini path: returns videoBuffer (no result URL yet)
    if (!outResult && result.videoBuffer) {
      const filename = `${taskId}.mp4`;
      const outputDir = path.join(__dirname, '..', 'public', 'tmp');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
      const outputPath = path.join(outputDir, filename);
      fs.writeFileSync(outputPath, result.videoBuffer);
      outResult = `/static/${filename}`;
      if (req) {
        const host = `${req.protocol}://${req.get('host')}`;
        outResult = `${host}${outResult}`;
      }
    }

    console.log(`✅ Image-to-video completed - TaskID: ${taskId}`);
    taskStore.set(taskId, {
      status:'done',
      result: outResult,
      text: result.text || prompt,
      cost: result.cost
    });
  } catch (error) {
    console.error(`❌ Error in finalizeVideo:`, error);
    taskStore.set(taskId, { status: 'error', error: error.message || error.toString() });
  }
}

function finalizeTranscription(taskId, result) {
  try {
    if (!result || result.error) {
      taskStore.set(taskId, { status:'error', ...result });
      return;
    }

    taskStore.set(taskId, {
      status:'done',
      result: result.text,
      language: result.language
    });
  } catch (error) {
    console.error(`❌ Error in finalizeTranscription:`, error);
    taskStore.set(taskId, { status: 'error', error: error.message || error.toString() });
  }
}

function finalize(taskId, result, req) {
  if (!result || result.error) {
    taskStore.set(taskId, { status:'error', error: result?.error || 'Unknown error' });
    return;
  }
  const filename = `${taskId}.png`;
  const outputDir = path.join(__dirname, '..', 'public', 'tmp');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive:true });
  fs.writeFileSync(path.join(outputDir, filename), result.imageBuffer);

  const host = `${req.protocol}://${req.get('host')}`;
  taskStore.set(taskId, {
    status:'done',
    result: `${host}/static/${filename}`,
    text: result.text
  });
}

module.exports = router;