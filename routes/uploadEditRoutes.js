const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({
  limits: {
    fileSize: 50 * 1024 * 1024,
    fieldSize: 50 * 1024 * 1024
  }
});
const { v4: uuidv4 } = require('uuid');
const taskStore = require('../store/taskStore');
const geminiService = require('../services/geminiService');
const openaiService = require('../services/openaiService');
const runwareService = require('../services/runwareService');
const replicateService = require('../services/replicateService');
const lemonfoxService = require('../services/lemonfoxService');
const fs = require('fs');
const path = require('path');

router.post('/upload-edit', upload.single('file'), async (req, res) => {  
  const { prompt, provider } = req.body;
  if (!prompt || !req.file) {
    return res.status(400).json({ status:'error', error:'Missing prompt or file' });
  }

  const taskId = uuidv4();
  console.log(`🖼️ Starting image edit with ${provider || 'Gemini'}`);
  taskStore.set(taskId, { status:'pending' });
  res.json({ taskId });

  try {
    let result;
    if (provider === 'openai') {
      result = await openaiService.editImageWithText(prompt, req.file.buffer);
    } else {
      const base64 = req.file.buffer.toString('base64');
      result = await geminiService.editImageWithText(prompt, base64);
    }
    
    finalize(taskId, result, req);
  } catch (error) {
    console.error(`❌ Image edit error:`, error.message);
    taskStore.set(taskId, { status: 'error', error: error.message || 'Unknown error occurred' });
  }
});

router.post('/upload-video', upload.single('file'), async (req, res) => {  
  const { prompt, provider } = req.body;
  if (!prompt || !req.file) {
    return res.status(400).json({ status:'error', error:'Missing prompt or file' });
  }

  const taskId = uuidv4();
  console.log(`🎬 Starting image-to-video with ${provider || 'runware'}`);
  taskStore.set(taskId, { status:'pending' });
  res.json({ taskId });

  try {
    let result;
    if (provider === 'replicate') {
      result = await replicateService.generateVideoFromImage(req.file.buffer, prompt);
    } else {
      const base64 = req.file.buffer.toString('base64');
      result = await runwareService.generateVideoFromImage(prompt, base64);
    }
    
    finalizeVideo(taskId, result, prompt, req);
  } catch (error) {
    console.error(`❌ Image-to-video error:`, error.message);
    taskStore.set(taskId, { status: 'error', error: error.message || 'Unknown error occurred' });
  }
});

router.post('/upload-video-edit', upload.single('file'), async (req, res) => {  
  const { prompt } = req.body;
  if (!prompt || !req.file) {
    return res.status(400).json({ status:'error', error:'Missing prompt or file' });
  }

  const taskId = uuidv4();
  console.log(`🎬 Starting video-to-video with Replicate`);
  taskStore.set(taskId, { status:'pending' });
  res.json({ taskId });

  try {
    const result = await replicateService.generateVideoFromVideo(req.file.buffer, prompt);
    finalizeVideo(taskId, result, prompt, req);
  } catch (error) {
    console.error(`❌ Video-to-video error:`, error.message);
    taskStore.set(taskId, { status: 'error', error: error.message || 'Unknown error occurred' });
  }
});

router.post('/upload-transcribe', upload.single('file'), async (req, res) => {  
  if (!req.file) {
    return res.status(400).json({ status:'error', error:'Missing audio file' });
  }

  const taskId = uuidv4();
  console.log(`🎤 Starting audio transcription`);
  taskStore.set(taskId, { status:'pending' });
  res.json({ taskId });

  try {
    const filename = req.file.originalname || 'audio.wav';
    const result = await lemonfoxService.transcribeAudio(req.file.buffer, filename);
    
    finalizeTranscription(taskId, result);
  } catch (error) {
    console.error(`❌ Transcription error:`, error.message);
    taskStore.set(taskId, { status: 'error', error: error.message || 'Unknown error occurred' });
  }
});

function finalizeVideo(taskId, result, prompt, req = null) {
  try {
    if (!result || result.error) {
      taskStore.set(taskId, { status:'error', error: result?.error || 'Task failed without error details' });
      return;
    }

    console.log(`✅ Video generation completed`);
    
    let videoURL = result.result;
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
    console.error(`❌ Error in finalizeVideo:`, error.message);
    taskStore.set(taskId, { status: 'error', error: error.message || 'Failed to finalize video' });
  }
}

function finalize(taskId, result, req) {
  try {
    if (!result || result.error) {
      taskStore.set(taskId, { status:'error', error: result?.error || 'Task failed without error details' });
      return;
    }
    
    const filename = `${taskId}.png`;
    const outputDir = path.join(__dirname, '..', 'public', 'tmp');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive:true });
    fs.writeFileSync(path.join(outputDir, filename), result.imageBuffer);

    console.log(`✅ Image edit completed`);
    const host = `${req.protocol}://${req.get('host')}`;
    taskStore.set(taskId, {
      status:'done',
      result: `${host}/static/${filename}`,
      text: result.text
    });
  } catch (error) {
    console.error(`❌ Error in finalize:`, error.message);
    taskStore.set(taskId, { status: 'error', error: error.message || 'Failed to save file' });
  }
}

function finalizeTranscription(taskId, result) {
  try {
    if (!result || result.error) {
      taskStore.set(taskId, { status:'error', error: result?.error || 'Task failed without error details' });
      return;
    }

    console.log(`✅ Audio transcription completed`);
    taskStore.set(taskId, {
      status:'done',
      result: result.text,
      language: result.language
    });
  } catch (error) {
    console.error(`❌ Error in finalizeTranscription:`, error.message);
    taskStore.set(taskId, { status: 'error', error: error.message || 'Failed to finalize transcription' });
  }
}

module.exports = router;