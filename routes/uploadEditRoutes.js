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
const replicateService = require('../services/replicateService');
const kieService = require('../services/kieService');
const lemonfoxService = require('../services/lemonfoxService');
const { validateAndSanitizePrompt } = require('../utils/textSanitizer');
const { isErrorResult, getTaskError } = require('../utils/errorHandler');
const fs = require('fs');
const path = require('path');

router.post('/upload-edit', upload.single('file'), async (req, res) => {  
  const { prompt, provider } = req.body;
  
  // Validate required fields
  if (!prompt || !req.file) {
    return res.status(400).json({ 
      status: 'error', 
      error: 'Missing prompt or file' 
    });
  }

  // Validate and sanitize prompt
  let sanitizedPrompt;
  try {
    sanitizedPrompt = validateAndSanitizePrompt(prompt);
  } catch (validationError) {
    return res.status(400).json({ 
      status: 'error', 
      error: validationError.message 
    });
  }

  const taskId = uuidv4();
  taskStore.set(taskId, { status:'pending' });
  res.json({ taskId });

  try {
    let result;
    if (provider === 'openai') {
      result = await openaiService.editImageWithText(sanitizedPrompt, req.file.buffer);
    } else if (provider === 'gemini') {
      const base64 = req.file.buffer.toString('base64');
      result = await geminiService.editImageWithText(sanitizedPrompt, base64);
    } else {
      // Default to openai for image editing
      result = await openaiService.editImageWithText(sanitizedPrompt, req.file.buffer);
    }
    
    await finalize(taskId, result, req);
  } catch (error) {
    console.error(`❌ Image edit error:`, error);
    taskStore.set(taskId, getTaskError(error));
  }
});

router.post('/upload-video', upload.single('file'), async (req, res) => {  
  const { prompt, provider, model } = req.body;
  if (!prompt || !req.file) {
    return res.status(400).json({ status:'error', error:'Missing prompt or file' });
  }

  const taskId = uuidv4();
  taskStore.set(taskId, { status:'pending' });
  res.json({ taskId });

  try {
    let result;
    if (provider === 'replicate') {
      result = await replicateService.generateVideoFromImage(req.file.buffer, prompt, model);
    } else if (provider === 'gemini') {
      result = await geminiService.generateVideoWithImage(prompt, req.file.buffer);
    } else if (provider === 'kie') {
      result = await kieService.generateVideoWithImage(prompt, req.file.buffer, model);
    } else {
      // Default to replicate for image-to-video generation
      result = await replicateService.generateVideoFromImage(req.file.buffer, prompt, model);
    }
    
    await finalizeVideo(taskId, result, prompt, req);
  } catch (error) {
    console.error(`❌ Image-to-video error:`, error);
    taskStore.set(taskId, getTaskError(error));
  }
});

router.post('/upload-video-edit', upload.single('file'), async (req, res) => {  
  const { prompt } = req.body;
  if (!prompt || !req.file) {
    return res.status(400).json({ status:'error', error:'Missing prompt or file' });
  }

  const taskId = uuidv4();
  taskStore.set(taskId, { status:'pending' });
  res.json({ taskId });

  try {
    const result = await replicateService.generateVideoFromVideo(req.file.buffer, prompt);
    await finalizeVideo(taskId, result, prompt, req);
  } catch (error) {
    console.error(`❌ Video-to-video error:`, error);
    taskStore.set(taskId, getTaskError(error));
  }
});

router.post('/upload-transcribe', upload.single('file'), async (req, res) => {  
  if (!req.file) {
    return res.status(400).json({ status:'error', error:'Missing audio file' });
  }

  const taskId = uuidv4();
  taskStore.set(taskId, { status:'pending' });
  res.json({ taskId });

  try {
    const filename = req.file.originalname || 'audio.wav';
    const result = await lemonfoxService.transcribeAudio(req.file.buffer, filename);
    
    await finalizeTranscription(taskId, result);
  } catch (error) {
    console.error(`❌ Transcription error:`, error);
    taskStore.set(taskId, getTaskError(error));
  }
});

function finalizeVideo(taskId, result, prompt, req = null) {
  try {
    if (isErrorResult(result)) {
      taskStore.set(taskId, getTaskError(result));
      return;
    }
    
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
    console.error(`❌ Error in finalizeVideo:`, error);
    taskStore.set(taskId, getTaskError(error, 'Failed to finalize video'));
  }
}

function finalize(taskId, result, req) {
  try {
    if (!result || result.error) {
      taskStore.set(taskId, getTaskError(result));
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
  } catch (error) {
    console.error(`❌ Error in finalize:`, error);
    taskStore.set(taskId, getTaskError(error));
  }
}

function finalizeTranscription(taskId, result) {
  try {
    if (!result || result.error) {
      taskStore.set(taskId, getTaskError(result));
      return;
    }

    taskStore.set(taskId, {
      status:'done',
      result: result.text,
      language: result.language
    });
  } catch (error) {
    console.error(`❌ Error in finalizeTranscription:`, error);
    taskStore.set(taskId, getTaskError(error));
  }
}

// Callback route for Kie.ai music generation notifications
router.post('/music/callback', (req, res) => {
  try {
    console.log('🎵 Received music generation callback:', req.body);
    
    // Acknowledge the callback
    res.status(200).json({ 
      status: 'received', 
      message: 'Callback processed successfully' 
    });
    
    // The actual status checking is handled by polling in musicService
    // This is just for optional webhook notifications
    
  } catch (error) {
    console.error('❌ Error processing music callback:', error);
    res.status(500).json({ error: 'Callback processing failed' });
  }
});

// Speech-to-Song endpoint
router.post('/speech-to-song', upload.single('file'), async (req, res) => {
  console.log(`🎤 Starting Speech-to-Song generation for task ${req.body.taskId || 'new'}`);
  
  // Validate required fields
  if (!req.file) {
    return res.status(400).json({ 
      status: 'error', 
      error: 'Missing audio file' 
    });
  }

  // Validate file format and size
  const allowedTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave'];
  const rejectedTypes = ['audio/ogg', 'audio/webm', 'audio/flac'];
  const maxSize = 10 * 1024 * 1024; // 10MB
  const minSize = 50 * 1024; // 50KB (approximately 6+ seconds of audio)

  console.log(`📁 File received: ${req.file.originalname}, type: ${req.file.mimetype}, size: ${Math.round(req.file.size / 1024)}KB`);

  if (rejectedTypes.includes(req.file.mimetype)) {
    return res.status(400).json({
      status: 'error',
      error: `File type ${req.file.mimetype} is not supported by the AI service. Please convert to MP3 or WAV format first.`
    });
  }

  if (!allowedTypes.includes(req.file.mimetype)) {
    return res.status(400).json({
      status: 'error',
      error: `Unsupported file type: ${req.file.mimetype}. Please use MP3 or WAV format only.`
    });
  }

  if (req.file.size > maxSize) {
    return res.status(400).json({
      status: 'error',
      error: `File too large: ${Math.round(req.file.size / 1024 / 1024)}MB. Max size: 10MB`
    });
  }

  if (req.file.size < minSize) {
    return res.status(400).json({
      status: 'error',
      error: `File too small: ${Math.round(req.file.size / 1024)}KB. Please upload at least 6-10 seconds of clear speech (minimum 50KB).`
    });
  }

  console.log(`📁 File validation passed: ${req.file.originalname}, type: ${req.file.mimetype}, size: ${Math.round(req.file.size / 1024)}KB`);

  const taskId = uuidv4();
  taskStore.set(taskId, { status: 'pending' });
  res.json({ taskId });

  try {
    const musicService = require('../services/musicService');
    
    // Extract options from request
    const options = {
      title: req.body.title,
      style: req.body.style,
      vocalGender: req.body.vocalGender,
      styleWeight: req.body.styleWeight ? parseFloat(req.body.styleWeight) : undefined,
      audioWeight: req.body.audioWeight ? parseFloat(req.body.audioWeight) : undefined,
      weirdnessConstraint: req.body.weirdnessConstraint ? parseFloat(req.body.weirdnessConstraint) : undefined
    };

    console.log(`🎵 Processing speech-to-song with options:`, options);

    // Generate song from speech
    const result = await musicService.generateSongFromSpeech(req.file.buffer, options);

    if (isErrorResult(result)) {
      const errorMessage = getTaskError(result);
      console.error(`❌ Speech-to-Song generation failed for task ${taskId}:`, errorMessage);
      taskStore.set(taskId, { status: 'failed', error: errorMessage });
    } else {
      console.log(`✅ Speech-to-Song generation completed for task ${taskId}`);
      taskStore.set(taskId, { 
        status: 'completed', 
        result: result,
        type: 'speech-to-song',
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error(`❌ Speech-to-Song generation error for task ${taskId}:`, error);
    taskStore.set(taskId, { 
      status: 'failed', 
      error: error.message || 'Speech-to-Song generation failed' 
    });
  }
});

module.exports = router;