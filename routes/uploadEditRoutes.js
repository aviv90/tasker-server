const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
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
    console.log('❌ Upload edit: Missing prompt or file');
    return res.status(400).json({ status:'error', error:'Missing prompt or file' });
  }

  const taskId = uuidv4();
  console.log(`🖼️ Starting image edit with ${provider || 'Gemini'} - TaskID: ${taskId}`);
  taskStore.set(taskId, { status:'pending' });
  res.json({ taskId });

  try {
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
  } catch (error) {
    console.error(`❌ Unexpected error in upload-edit - TaskID: ${taskId}:`, error.message);
    taskStore.set(taskId, { status: 'error', error: error.message || error.toString() || 'Unknown error occurred' });
  }
});

router.post('/upload-video', upload.single('file'), async (req, res) => {  
  const { prompt, provider } = req.body;
  if (!prompt || !req.file) {
    console.log('❌ Upload video: Missing prompt or file');
    return res.status(400).json({ status:'error', error:'Missing prompt or file' });
  }

  const taskId = uuidv4();
  console.log(`🎬 Starting image-to-video with ${provider || 'runware'} - TaskID: ${taskId}`);
  taskStore.set(taskId, { status:'pending' });
  res.json({ taskId });

  try {
    let result;
    if (provider === 'replicate') {
      console.log(`🎬 Generating video with Replicate - TaskID: ${taskId}`);
      result = await replicateService.generateVideoFromImage(req.file.buffer, prompt);
    } else {
      console.log(`🎬 Generating video with Runware - TaskID: ${taskId}`);
      const base64 = req.file.buffer.toString('base64');
      result = await runwareService.generateVideoFromImage(prompt, base64);
    }
    
    finalizeVideo(taskId, result, prompt);
  } catch (error) {
    console.error(`❌ Unexpected error in upload-video - TaskID: ${taskId}:`, error.message);
    taskStore.set(taskId, { status: 'error', error: error.message || error.toString() || 'Unknown error occurred' });
  }
});

router.post('/upload-video-edit', upload.single('file'), async (req, res) => {  
  const { prompt, provider } = req.body;
  if (!prompt || !req.file) {
    console.log('❌ Upload video edit: Missing prompt or file');
    return res.status(400).json({ status:'error', error:'Missing prompt or file' });
  }

  const taskId = uuidv4();
  console.log(`🎬 Starting video-to-video with ${provider || 'replicate'} - TaskID: ${taskId}`);
  taskStore.set(taskId, { status:'pending' });
  res.json({ taskId });

  try {
    let result;
    if (provider === 'replicate') {
      console.log(`🎬 Generating video-to-video with Replicate - TaskID: ${taskId}`);
      result = await replicateService.generateVideoFromVideo(req.file.buffer, prompt);
    } else {
      console.log(`❌ Video-to-video only supported by Replicate - TaskID: ${taskId}`);
      taskStore.set(taskId, { 
        status: 'error', 
        error: 'Video-to-video transformation is currently only supported by Replicate. Please use provider=replicate' 
      });
      return;
    }
    
    finalizeVideo(taskId, result, prompt);
  } catch (error) {
    console.error(`❌ Unexpected error in upload-video-edit - TaskID: ${taskId}:`, error.message);
    taskStore.set(taskId, { status: 'error', error: error.message || error.toString() || 'Unknown error occurred' });
  }
});

function finalizeVideo(taskId, result, prompt) {
  try {
    if (!result || result.error) {
      console.log(`❌ Video generation failed - TaskID: ${taskId}`);
      taskStore.set(taskId, { status:'error', error: result?.error || result?.message || 'Task failed without error details' });
      return;
    }

    console.log(`✅ Video generation completed - TaskID: ${taskId}`);
    taskStore.set(taskId, {
      status:'done',
      result: result.result,
      text: result.text || prompt,
      cost: result.cost
    });
  } catch (error) {
    console.error(`❌ Error in finalizeVideo function - TaskID: ${taskId}:`, error.message);
    taskStore.set(taskId, { status: 'error', error: error.message || error.toString() || 'Failed to finalize video' });
  }
}

function finalize(taskId, result, req) {
  try {
    if (!result || result.error) {
      console.log(`❌ Image edit failed - TaskID: ${taskId}`);
      taskStore.set(taskId, { status:'error', error: result?.error || result?.message || 'Task failed without error details' });
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
  } catch (error) {
    console.error(`❌ Error in finalize function - TaskID: ${taskId}:`, error.message);
    taskStore.set(taskId, { status: 'error', error: error.message || error.toString() || 'Failed to save file' });
  }
}

router.post('/upload-transcribe', upload.single('file'), async (req, res) => {  
  if (!req.file) {
    console.log('❌ Upload transcribe: Missing audio file');
    return res.status(400).json({ status:'error', error:'Missing audio file' });
  }

  const taskId = uuidv4();
  console.log(`🎤 Starting audio transcription - TaskID: ${taskId}`);
  taskStore.set(taskId, { status:'pending' });
  res.json({ taskId });

  try {
    // Get original filename or create a default one
    const filename = req.file.originalname || 'audio.wav';
    const result = await lemonfoxService.transcribeAudio(req.file.buffer, filename);
    
    finalizeTranscription(taskId, result);
  } catch (error) {
    console.error(`❌ Unexpected error in upload-transcribe - TaskID: ${taskId}:`, error.message);
    taskStore.set(taskId, { status: 'error', error: error.message || error.toString() || 'Unknown error occurred' });
  }
});

function finalizeTranscription(taskId, result) {
  try {
    if (!result || result.error) {
      console.log(`❌ Audio transcription failed - TaskID: ${taskId}`);
      taskStore.set(taskId, { status:'error', error: result?.error || result?.message || 'Task failed without error details' });
      return;
    }

    console.log(`✅ Audio transcription completed - TaskID: ${taskId}`);
    taskStore.set(taskId, {
      status:'done',
      result: result.text,
      language: result.language
    });
  } catch (error) {
    console.error(`❌ Error in finalizeTranscription function - TaskID: ${taskId}:`, error.message);
    taskStore.set(taskId, { status: 'error', error: error.message || error.toString() || 'Failed to finalize transcription' });
  }
}

module.exports = router;