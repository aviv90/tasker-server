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
const { voiceService } = require('../services/voiceService');
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
    console.log(`🎤 Starting enhanced voice processing pipeline with Gemini integration...`);
    console.log(`📋 Pipeline: Transcription → Voice Clone → Gemini Response → Text-to-Speech → Cleanup`);
    
    // Step 1: Speech-to-Text transcription
    const originalExtension = path.extname(req.file.originalname).slice(1).toLowerCase();
    const supportedFormats = ['mp3', 'wav', 'ogg', 'opus', 'webm', 'm4a', 'aac', 'flac'];
    const format = supportedFormats.includes(originalExtension) ? originalExtension : 'wav';
    
    const transcriptionOptions = {
      model: req.body.model || 'scribe_v1',
      language: req.body.language === 'auto' ? null : req.body.language || null,
      removeNoise: req.body.removeNoise !== 'false',
      removeFiller: req.body.removeFiller !== 'false',
      optimizeLatency: parseInt(req.body.optimizeLatency) || 0,
      format: format
    };
    
    console.log(`🔄 Step 1: Transcribing speech...`);
    const transcriptionResult = await speechService.speechToText(req.file.buffer, transcriptionOptions);
    
    if (transcriptionResult.error) {
      console.error('❌ Transcription failed:', transcriptionResult.error);
      return await finalizeTranscription(taskId, transcriptionResult);
    }

    const transcribedText = transcriptionResult.text;
    console.log(`✅ Step 1 complete: Transcribed ${transcribedText.length} characters`);

    // Step 2: Create Instant Voice Clone with optimal parameters
    console.log(`🔄 Step 2: Creating voice clone with optimized parameters...`);
    const voiceName = req.body.voiceName || `Voice_${Date.now()}`;
    
    // Use our own language detection on transcribed text for consistency
    const originalLanguage = voiceService.detectLanguage(transcribedText);
    const sttDetected = transcriptionResult.metadata?.language || 'auto';
    console.log(`🌐 Language detection for voice clone:`);
    console.log(`   - STT detected: ${sttDetected}`);
    console.log(`   - Our detection: ${originalLanguage}`);
    
    const voiceCloneOptions = {
      name: voiceName,
      description: req.body.voiceDescription || `High-quality voice clone (${originalLanguage})`,
      removeBackgroundNoise: req.body.removeBackgroundNoise !== 'false', // Always true for optimal quality
      labels: JSON.stringify({
        accent: originalLanguage === 'he' ? 'hebrew' : 'natural',
        use_case: 'conversational',
        quality: 'high',
        style: 'natural',
        language: originalLanguage
      })
    };

    const voiceCloneResult = await voiceService.createInstantVoiceClone(req.file.buffer, voiceCloneOptions);
    
    if (voiceCloneResult.error) {
      console.error('❌ Voice cloning failed:', voiceCloneResult.error);
      // If voice cloning fails, return error with transcription
      return await finalizeVoiceProcessing(taskId, {
        text: transcribedText,
        error: voiceCloneResult.error
      }, req);
    }

    const voiceId = voiceCloneResult.voiceId;
    console.log(`✅ Step 2 complete: Voice clone created with ID ${voiceId}`);

    // Step 3: Generate Gemini response (Chatbot)
    console.log(`🔄 Step 3: Generating Gemini response to transcribed text...`);
    const geminiOptions = {
      model: req.body.geminiModel || 'gemini-2.5-flash'
    };

    const geminiResult = await geminiService.generateTextResponse(transcribedText, geminiOptions);
    
    let textForTTS = transcribedText; // Default to original text
    
    if (geminiResult.error) {
      console.warn('⚠️ Gemini generation failed:', geminiResult.error);
      console.log('📝 Using original transcribed text for TTS');
    } else {
      textForTTS = geminiResult.text;
      console.log(`✅ Step 3 complete: Gemini generated ${textForTTS.length} characters`);
      console.log(`💬 Gemini response: "${textForTTS.substring(0, 100)}..."`);
    }

    // Step 4: Text-to-Speech with cloned voice
    console.log(`🔄 Step 4: Converting text to speech with cloned voice...`);
    
    // For TTS, use the original language to maintain consistency throughout the flow
    const ttsLanguage = originalLanguage;
    console.log(`🌐 Language consistency in upload-transcribe:`);
    console.log(`   - Original (from transcription): ${originalLanguage}`);
    console.log(`   - TTS (forced same): ${ttsLanguage}`);
    
    const ttsOptions = {
      modelId: req.body.ttsModel || 'eleven_v3', // Use the most advanced model by default
      outputFormat: req.body.outputFormat || 'mp3_44100_128', // ElevenLabs doesn't support ogg_vorbis
      languageCode: ttsLanguage
    };

    // Only add optimizeStreamingLatency if explicitly requested and not using eleven_v3
    if (req.body.optimizeStreamingLatency && (req.body.ttsModel && req.body.ttsModel !== 'eleven_v3')) {
      ttsOptions.optimizeStreamingLatency = parseInt(req.body.optimizeStreamingLatency);
      console.log(`⚡ Added streaming latency optimization: ${ttsOptions.optimizeStreamingLatency}`);
    }

    const ttsResult = await voiceService.textToSpeech(voiceId, textForTTS, ttsOptions);
    
    if (ttsResult.error) {
      console.error('❌ Text-to-speech failed:', ttsResult.error);
      // If TTS fails, return error with transcription
      return await finalizeVoiceProcessing(taskId, {
        text: transcribedText,
        error: ttsResult.error
      }, req);
    }

    console.log(`✅ Step 4 complete: Audio generated at ${ttsResult.audioUrl}`);

    // Final result: Complete pipeline success
    console.log(`📝 Finalizing with transcribed text: "${transcribedText.substring(0, 100)}..."`);
    await finalizeVoiceProcessing(taskId, {
      text: transcribedText, // The original transcribed text - this is what should be returned
      result: ttsResult.audioUrl,
      geminiResponse: geminiResult.error ? null : geminiResult.text, // Gemini response if successful
      voiceId: voiceId,
      transcriptionMetadata: transcriptionResult.metadata,
      voiceCloneMetadata: voiceCloneResult.metadata,
      geminiMetadata: geminiResult.error ? null : geminiResult.metadata,
      ttsMetadata: ttsResult.metadata
    }, req);

    console.log(`🎉 Full voice processing pipeline completed successfully!`);

    // Step 4: Clean up - delete the temporary voice clone
    console.log(`🧹 Step 4: Cleaning up voice clone ${voiceId}...`);
    try {
      const deleteResult = await voiceService.deleteVoice(voiceId);
      if (deleteResult.error) {
        console.warn(`⚠️ Warning: Could not delete voice clone ${voiceId}:`, deleteResult.error);
      } else {
        console.log(`✅ Voice clone ${voiceId} deleted successfully`);
      }
    } catch (cleanupError) {
      console.warn(`⚠️ Warning: Voice cleanup failed:`, cleanupError.message);
    }
    
  } catch (error) {
    console.error(`❌ Pipeline error:`, error);
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
    // Check if there's an error
    if (!result || result.error) {
      const errorResult = {
        status: 'error',
        error: result.error || 'Transcription failed'
      };
      
      // If we have transcribed text despite the error, include it
      if (result?.text) {
        errorResult.text = result.text;
      }
      
      taskStore.set(taskId, errorResult);
      console.log(`❌ Transcription failed: ${result?.error || 'Unknown error'}`);
      return;
    }

    // Success case
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

function finalizeVoiceProcessing(taskId, result, req = null) {
  try {
    // Check if there's an error
    if (result.error) {
      const errorResult = {
        status: 'error',
        error: result.error
      };
      
      // If we have transcribed text, include it
      if (result.text) {
        errorResult.text = result.text;
      }
      
      taskStore.set(taskId, errorResult);
      console.log(`❌ Voice processing failed: ${result.error}`);
      return;
    }

    // Success case - create full URL for audio file
    let audioURL = result.result || result.audioUrl;
    if (req && audioURL && audioURL.startsWith('/static/')) {
      const host = `${req.protocol}://${req.get('host')}`;
      audioURL = `${host}${audioURL}`;
    }

    const taskResult = {
      status: 'done',
      text: result.text,
      result: audioURL
    };

    console.log(`📝 Saving final result with text: "${result.text?.substring(0, 100) || 'MISSING TEXT'}..."`);
    taskStore.set(taskId, taskResult);
    console.log(`✅ Voice processing completed: ${result.text?.length || 0} chars → ${audioURL}`);
  } catch (error) {
    console.error(`❌ Error in finalizeVoiceProcessing:`, error);
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

// Cleanup endpoint - delete all custom voices
router.post('/cleanup-voices', async (req, res) => {
  try {
    console.log('🧹 Starting voice cleanup...');
    
    const result = await voiceService.getVoices();
    if (result.error) {
      return res.status(500).json({ status: 'error', error: result.error });
    }

    const voices = result.voices || [];
    console.log(`Found ${voices.length} total voices`);

    // Filter only custom voices (not built-in ElevenLabs voices)
    const customVoices = voices.filter(voice => 
      voice.category === 'cloned' || 
      voice.category === 'premade' && voice.sharing?.status === 'private' ||
      voice.name?.startsWith('Voice_')
    );

    console.log(`Found ${customVoices.length} custom voices to delete`);

    let deletedCount = 0;
    let errors = [];

    for (const voice of customVoices) {
      try {
        const deleteResult = await voiceService.deleteVoice(voice.voice_id);
        if (deleteResult.error) {
          errors.push(`${voice.name}: ${deleteResult.error}`);
        } else {
          deletedCount++;
          console.log(`✅ Deleted voice: ${voice.name} (${voice.voice_id})`);
        }
      } catch (error) {
        errors.push(`${voice.name}: ${error.message}`);
      }
    }

    res.json({
      status: 'done',
      message: `Cleanup completed: ${deletedCount} voices deleted`,
      deleted: deletedCount,
      total: customVoices.length,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('❌ Voice cleanup error:', error);
    res.status(500).json({ 
      status: 'error', 
      error: error.message || 'Voice cleanup failed' 
    });
  }
});

module.exports = router;