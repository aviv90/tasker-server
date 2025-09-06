const express = require('express');
const router = express.Router();
const multer = require('multer');
const CloudConvert = require('cloudconvert');
const FormData = require('form-data');
const { Readable } = require('stream');
const axios = require('axios');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    fieldSize: 50 * 1024 * 1024
  }
});
const { v4: uuidv4 } = require('uuid');
const taskStore = require('../store/taskStore');

// Map between our task IDs and Kie.ai task IDs for callback handling
const kieTaskMapping = new Map();
const geminiService = require('../services/geminiService');
const openaiService = require('../services/openaiService');
const replicateService = require('../services/replicateService');
const kieService = require('../services/kieService');
const speechService = require('../services/speechService');
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
  
  // Validate buffer is not empty
  if (!inputBuffer || inputBuffer.length === 0) {
    throw new Error('Input buffer is empty');
  }
  
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

    // Create CloudConvert job
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

    // Upload file using direct buffer (this method works!)
    const uploadTask = job.tasks.find(task => task.name === 'import');
    await cloudconvert.tasks.upload(uploadTask, inputBuffer, `audio.${inputFormat}`);

    // Wait for conversion to complete
    job = await cloudconvert.jobs.wait(job.id);    // Log all tasks to see what failed
    console.log(`🔍 All job tasks:`, JSON.stringify(job.tasks, null, 2));

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

  // Validate file size for ElevenLabs (25MB limit)
  if (req.file.size > 25 * 1024 * 1024) {
    return res.status(413).json({
      status: 'error',
      error: `File too large: ${Math.round(req.file.size / 1024 / 1024)}MB. Maximum size is 25MB.`
    });
  }

  const taskId = uuidv4();
  taskStore.set(taskId, { status:'pending' });
  res.json({ taskId });

  try {
    console.log(`🎤 Speech-to-Text transcription started`);
    
    const originalExtension = path.extname(req.file.originalname).slice(1).toLowerCase();
    const supportedFormats = ['mp3', 'wav', 'ogg', 'opus', 'webm', 'm4a', 'aac', 'flac'];
    const format = supportedFormats.includes(originalExtension) ? originalExtension : 'wav';
    
    const options = {
      model: req.body.model || 'scribe_v1',
      language: req.body.language === 'auto' ? null : req.body.language || null,
      removeNoise: req.body.removeNoise !== 'false',
      removeFiller: req.body.removeFiller !== 'false',
      optimizeLatency: parseInt(req.body.optimizeLatency) || 0,
      format: format
    };
    
    const result = await speechService.speechToText(req.file.buffer, options);
    
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

    const taskResult = {
      status:'done',
      result: result.text,
      text: result.text,
      language: result.metadata?.language || 'unknown',
      timestamp: new Date().toISOString()
    };

    // Add metadata if available
    if (result.metadata) {
      taskResult.metadata = result.metadata;
    }

    taskStore.set(taskId, taskResult);
    console.log(`✅ Transcription completed. Text length: ${result.text?.length || 0} characters`);
  } catch (error) {
    console.error(`❌ Error in finalizeTranscription:`, error);
    taskStore.set(taskId, getTaskError(error));
  }
}

// Callback route for Kie.ai music generation notifications
router.post('/music/callback', (req, res) => {
  try {
    console.log('🎵 Music callback received');
    
    const callbackData = req.body;
    
    // Find our task ID based on the Kie.ai task ID
    if (callbackData.data && callbackData.data.task_id) {
      const kieTaskId = callbackData.data.task_id;
      const ourTaskId = kieTaskMapping.get(kieTaskId);
      
      if (ourTaskId && callbackData.data.callbackType === 'complete' && callbackData.code === 200) {
        console.log(`🎵 Completing task ${ourTaskId}`);
        
        // Extract songs from callback data
        const songs = callbackData.data.data || [];
        
        if (songs.length > 0) {
          // Get the first song - try multiple possible field names
          const firstSong = songs[0];
          const songUrl = firstSong.audioUrl || firstSong.audio_url || firstSong.url;
          
          if (songUrl) {
            // Update our task store with the direct URL
            taskStore.set(ourTaskId, { 
              status: 'done', 
              result: songUrl,
              type: 'speech-to-song',
              timestamp: new Date().toISOString()
            });
            
            console.log(`✅ Task ${ourTaskId} completed successfully`);
            
            // Clean up the mapping
            kieTaskMapping.delete(kieTaskId);
          } else {
            console.log(`⚠️ No audio URL found for task ${ourTaskId}`);
          }
        } else {
          console.log(`⚠️ No songs found for task ${ourTaskId}`);
        }
      }
    }
    
    // Acknowledge the callback
    res.status(200).json({ 
      status: 'received', 
      message: 'Callback processed successfully' 
    });
    
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
  const supportedTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/ogg', 'audio/opus', 'audio/webm', 'audio/m4a', 'audio/aac'];
  const maxSize = 10 * 1024 * 1024; // 10MB
  const minSize = 10 * 1024; // 10KB

  console.log(`📁 File received: ${req.file.originalname}, type: ${req.file.mimetype}, size: ${Math.round(req.file.size / 1024)}KB`);

  if (!supportedTypes.includes(req.file.mimetype)) {
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

  const taskId = uuidv4();
  taskStore.set(taskId, { status: 'pending' });
  res.json({ taskId }); // Send response immediately

  try {
    const musicService = require('../services/musicService');
    
    // Use original audio buffer directly (no conversion)
    const audioBuffer = req.file.buffer;
    const fileType = req.file.mimetype;
    
    console.log(`🎤 Using original audio format: ${fileType}, size: ${Math.round(audioBuffer.length / 1024)}KB`);
    
    // Extract options from request with optimized defaults
    const options = {
      title: req.body.title || 'Generated Song from Speech',
      style: req.body.style || 'original voice, subtle backing',
      vocalGender: req.body.vocalGender || (Math.random() > 0.5 ? 'm' : 'f'),
      styleWeight: req.body.styleWeight ? parseFloat(req.body.styleWeight) : undefined, // Let service generate random in 0.3-0.6 range
      audioWeight: req.body.audioWeight ? parseFloat(req.body.audioWeight) : undefined, // Let service generate random in 0.7-0.9 range
      weirdnessConstraint: req.body.weirdnessConstraint ? parseFloat(req.body.weirdnessConstraint) : undefined // Let service generate random in 0.1-0.3 range
    };

    console.log(`🎵 Starting speech-to-song generation`);
    console.log(`🎤 Using audio format: ${fileType}, size: ${Math.round(audioBuffer.length / 1024)}KB`);

    // Generate song from speech
    const result = await musicService.generateSongFromSpeech(audioBuffer, options);

    // Store the mapping between our task ID and Kie.ai task ID for callback handling
    if (result.taskId) {
      kieTaskMapping.set(result.taskId, taskId);
      console.log(`🔗 Mapped Kie task ${result.taskId} to our task ${taskId}`);
    }

    if (isErrorResult(result)) {
      const errorMessage = getTaskError(result);
      console.error(`❌ Speech-to-Song generation failed for task ${taskId}:`, errorMessage);
      taskStore.set(taskId, { status: 'failed', error: errorMessage });
    } else {
      console.log(`✅ Speech-to-Song generation completed for task ${taskId}`);
      
      // Extract the first song URL for simple response format
      let songUrl = null;
      if (result.songs && result.songs.length > 0) {
        songUrl = result.songs[0].audioUrl;
      }
      
      taskStore.set(taskId, { 
        status: 'done', 
        result: songUrl || result, // Use simple URL or fallback to full result
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