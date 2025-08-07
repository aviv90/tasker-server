const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer();
const { v4: uuidv4 } = require('uuid');
const taskStore = require('../store/taskStore');
const geminiService = require('../services/geminiService');
const openaiService = require('../services/openaiService');
const runwareService = require('../services/runwareService');
const lemonfoxService = require('../services/lemonfoxService');
const fs = require('fs');
const path = require('path');

router.post('/upload-edit', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      console.log('❌ Upload edit - Multer error:', err.message);
      return res.status(400).json({ 
        status:'error', 
        error:'Invalid file upload. Make sure to use Content-Type: multipart/form-data and include the file field.' 
      });
    }

    const { prompt, provider } = req.body;
    if (!prompt || !req.file) {
      console.log('❌ Upload edit: Missing prompt or file');
      return res.status(400).json({ status:'error', error:'Missing prompt or file' });
    }

    const taskId = uuidv4();
    console.log(`🖼️ Starting image edit with ${provider || 'Gemini'} - TaskID: ${taskId}`);
    taskStore.set(taskId, { status:'pending' });
    res.json({ taskId });

    let result;
    if (provider === 'openai') {
      // For OpenAI, pass the buffer directly
      result = await openaiService.editImageWithText(prompt, req.file.buffer);
    } else {
      // For Gemini, convert to base64 as before
      const base64 = req.file.buffer.toString('base64');
      result = await geminiService.editImageWithText(prompt, base64);
    }
    
    finalize(taskId, result, req);
  });
});

router.post('/upload-video', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      console.log('❌ Upload video - Multer error:', err.message);
      return res.status(400).json({ 
        status:'error', 
        error:'Invalid file upload. Make sure to use Content-Type: multipart/form-data and include the file field.' 
      });
    }

    const { prompt } = req.body;
    if (!prompt || !req.file) {
      console.log('❌ Upload video: Missing prompt or file');
      return res.status(400).json({ status:'error', error:'Missing prompt or file' });
    }

    const taskId = uuidv4();
    console.log(`🎬 Starting image-to-video - TaskID: ${taskId}`);
    taskStore.set(taskId, { status:'pending' });
    res.json({ taskId });

    // Convert image to base64 for Runware
    const base64 = req.file.buffer.toString('base64');
    const result = await runwareService.generateVideoFromImage(prompt, base64);
    
    finalizeVideo(taskId, result, prompt);
  });
});

function finalizeVideo(taskId, result, prompt) {
  if (!result || result.error) {
    console.log(`❌ Image-to-video failed - TaskID: ${taskId}`);
    taskStore.set(taskId, { status:'error', error: result?.error || 'Unknown error' });
    return;
  }

  console.log(`✅ Image-to-video completed - TaskID: ${taskId}`);
  taskStore.set(taskId, {
    status:'done',
    result: result.videoURL,
    text: result.text || prompt,
    cost: result.cost
  });
}

function finalize(taskId, result, req) {
  if (!result || result.error) {
    console.log(`❌ Image edit failed - TaskID: ${taskId}`);
    taskStore.set(taskId, { status:'error', error: result?.error || 'Unknown error' });
    return;
  }
  const filename = `${taskId}.png`;
  const outputDir = path.join(__dirname, '..', 'public', 'tmp');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive:true });
  fs.writeFileSync(path.join(outputDir, filename), result.imageBuffer);

  console.log(`✅ Image edit completed - TaskID: ${taskId}`);
  const host = `${req.protocol}://${req.get('host')}`;
  taskStore.set(taskId, {
    status:'done',
    result: `${host}/static/${filename}`,
    text: result.text
  });
}

router.post('/upload-transcribe', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      console.log('❌ Upload transcribe - Multer error:', err.message);
      return res.status(400).json({ 
        status:'error', 
        error:'Invalid file upload. Make sure to use Content-Type: multipart/form-data and include the file field.' 
      });
    }

    if (!req.file) {
      console.log('❌ Upload transcribe: Missing audio file');
      return res.status(400).json({ status:'error', error:'Missing audio file' });
    }

    const taskId = uuidv4();
    console.log(`🎤 Starting audio transcription - TaskID: ${taskId}`);
    taskStore.set(taskId, { status:'pending' });
    res.json({ taskId });

    // Get original filename or create a default one
    const filename = req.file.originalname || 'audio.wav';
    const result = await lemonfoxService.transcribeAudio(req.file.buffer, filename);
    
    finalizeTranscription(taskId, result);
  });
});

function finalizeTranscription(taskId, result) {
  if (!result || result.error) {
    console.log(`❌ Audio transcription failed - TaskID: ${taskId}`);
    taskStore.set(taskId, { status:'error', error: result?.error || 'Unknown error' });
    return;
  }

  console.log(`✅ Audio transcription completed - TaskID: ${taskId}`);
  taskStore.set(taskId, {
    status:'done',
    result: result.text,
    language: result.language
  });
}

module.exports = router;