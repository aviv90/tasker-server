const express = require('express');
const router = express.Router();
const multer = require('multer');
const CloudConvert = require('cloudconvert');
const FormData = require('form-data');
const { Readable } = require('stream');
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

// Initialize CloudConvert for audio conversion
const cloudconvert = new CloudConvert(process.env.CLOUDCONVERT_API_KEY || 'demo-key');

/**
 * Convert audio to MP3 using CloudConvert API
 * @param {Buffer} inputBuffer - The input audio buffer  
 * @param {string} inputMimetype - The input file mimetype
 * @returns {Promise<Buffer>} - The converted MP3 buffer
 */
async function convertAudioToMp3(inputBuffer, inputMimetype) {
  console.log(`🔄 Starting CloudConvert conversion from ${inputMimetype} to MP3...`);
  
  // Check API key
  if (!process.env.CLOUDCONVERT_API_KEY || process.env.CLOUDCONVERT_API_KEY === 'demo-key' || process.env.CLOUDCONVERT_API_KEY === 'your_cloudconvert_api_key_here') {
    throw new Error('CloudConvert API key not configured properly');
  }
  
  try {
    // Determine input format from mimetype
    const formatMap = {
      'audio/ogg': 'ogg',
      'audio/opus': 'opus', 
      'audio/webm': 'webm',
      'audio/m4a': 'm4a',
      'audio/aac': 'aac',
      'audio/mp4': 'mp4'
    };
    
    const inputFormat = formatMap[inputMimetype] || inputMimetype.split('/')[1];
    console.log(`📂 Input format: ${inputFormat}`);

    // Use the CloudConvert SDK upload method instead of manual fetch
    let job = await cloudconvert.jobs.create({
      tasks: {
        'import': {
          operation: 'import/upload'
        },
        'convert': {
          operation: 'convert',
          input: 'import',
          input_format: inputFormat,
          output_format: 'mp3',
          options: {
            audio_codec: 'mp3',
            audio_bitrate: 128,
            audio_frequency: 44100
          }
        },
        'export': {
          operation: 'export/url',
          input: 'convert'
        }
      }
    });

    console.log(`🚀 CloudConvert job created: ${job.id}`);

    // Upload file using SDK
    const uploadTask = job.tasks.find(task => task.name === 'import');
    const inputFile = new Readable();
    inputFile.push(inputBuffer);
    inputFile.push(null);

    await cloudconvert.tasks.upload(uploadTask, inputFile, `audio.${inputFormat}`, {
      size: inputBuffer.length
    });
    console.log(`📤 File uploaded successfully using SDK`);

    // Wait for conversion to complete
    job = await cloudconvert.jobs.wait(job.id);
    console.log(`⏳ Conversion completed`);

    // Download the converted file
    const exportTask = job.tasks.find(task => task.name === 'export');
    
    console.log(`📥 Export task:`, JSON.stringify(exportTask, null, 2));
    
    if (!exportTask || !exportTask.result || !exportTask.result.files || !exportTask.result.files[0]) {
      throw new Error('No export file found in CloudConvert response');
    }
    
    const file = exportTask.result.files[0];
    
    const downloadResponse = await fetch(file.url);
    if (!downloadResponse.ok) {
      throw new Error(`Download failed: ${downloadResponse.statusText}`);
    }

    const convertedBuffer = Buffer.from(await downloadResponse.arrayBuffer());
    console.log(`✅ CloudConvert conversion completed successfully. Output size: ${Math.round(convertedBuffer.length / 1024)}KB`);
    
    return convertedBuffer;

  } catch (error) {
    console.error(`❌ CloudConvert conversion failed:`, error);
    throw new Error(`Audio conversion failed: ${error.message}`);
  }
}

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
  const supportedTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave'];
  const convertibleTypes = ['audio/ogg', 'audio/opus', 'audio/webm', 'audio/m4a', 'audio/aac'];
  const allSupportedTypes = [...supportedTypes, ...convertibleTypes];
  const maxSize = 10 * 1024 * 1024; // 10MB
  const minSize = 10 * 1024; // 10KB (small files for testing)

  console.log(`📁 File received: ${req.file.originalname}, type: ${req.file.mimetype}, size: ${Math.round(req.file.size / 1024)}KB`);

  if (!allSupportedTypes.includes(req.file.mimetype)) {
    return res.status(400).json({
      status: 'error',
      error: `Unsupported file type: ${req.file.mimetype}. Supported: MP3, WAV, OGG, OPUS, WebM, M4A, AAC`
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
      error: `File too small: ${Math.round(req.file.size / 1024)}KB. Please upload at least a few seconds of clear speech.`
    });
  }

  console.log(`📁 File validation passed: ${req.file.originalname}, type: ${req.file.mimetype}, size: ${Math.round(req.file.size / 1024)}KB`);

  const taskId = uuidv4();
  taskStore.set(taskId, { status: 'pending' });

  try {
    const musicService = require('../services/musicService');
    
    // Convert audio if needed
    let audioBuffer = req.file.buffer;
    let fileType = req.file.mimetype;
    
    if (convertibleTypes.includes(req.file.mimetype)) {
      console.log(`🔄 Converting ${req.file.mimetype} to MP3...`);
      try {
        audioBuffer = await convertAudioToMp3(req.file.buffer, req.file.mimetype);
        fileType = 'audio/mp3';
        console.log(`✅ Conversion completed successfully`);
      } catch (conversionError) {
        console.error(`❌ Audio conversion failed:`, conversionError);
        taskStore.set(taskId, { 
          status: 'failed', 
          error: `Failed to convert ${req.file.mimetype} to MP3 using CloudConvert API. ${conversionError.message}` 
        });
        res.json({ taskId }); // Send the taskId so user can check status
        return;
      }
    }
    
    res.json({ taskId }); // Send response here, after conversion check
    
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
    console.log(`🎤 Using audio format: ${fileType}, size: ${Math.round(audioBuffer.length / 1024)}KB`);

    // Generate song from speech
    const result = await musicService.generateSongFromSpeech(audioBuffer, options);

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