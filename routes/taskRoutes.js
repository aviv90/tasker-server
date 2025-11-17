const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const taskStore = require('../store/taskStore');
const geminiService = require('../services/geminiService');
const openaiService = require('../services/openai');
const replicateService = require('../services/replicateService');
const kieService = require('../services/kieService');
const musicService = require('../services/musicService');
const { validateAndSanitizePrompt } = require('../utils/textSanitizer');
const { isErrorResult } = require('../utils/errorHandler');
const { finalizeVideo } = require('../utils/videoUtils');
const fs = require('fs');
const path = require('path');

router.post('/start-task', async (req, res) => {
    const { type, prompt, provider, model } = req.body;
    
    // Validate required fields
    if (!type || !prompt) {
        return res.status(400).json({ 
            status: 'error', 
            error: { message: 'Missing type or prompt', code: 'MISSING_FIELDS' }
        });
    }

    // Validate and sanitize prompt
    let sanitizedPrompt;
    try {
        sanitizedPrompt = validateAndSanitizePrompt(prompt);
    } catch (validationError) {
        return res.status(400).json({ 
            status: 'error', 
            error: validationError // Pass the entire error object
        });
    }

    const taskId = uuidv4();
    await taskStore.set(taskId, { status: 'pending' });
    res.json({ taskId });

    try {
        if (type === 'text-to-image') {
            let result;
            if (provider === 'openai') {
                result = await openaiService.generateImageWithText(sanitizedPrompt);
            } else {
                result = await geminiService.generateImageWithText(sanitizedPrompt);
            }
            await finalizeTask(taskId, result, req, 'png');
        } else if (type === 'text-to-video') {
            let result;
            if (provider === 'replicate') {
                result = await replicateService.generateVideoWithText(sanitizedPrompt, model);
            } else if (provider === 'gemini') {
                result = await geminiService.generateVideoWithText(sanitizedPrompt);
            } else if (provider === 'kie') {
                result = await kieService.generateVideoWithText(sanitizedPrompt, model);
            } else {
                // Default to replicate for video generation
                result = await replicateService.generateVideoWithText(sanitizedPrompt, model);
            }
            
            await finalizeVideo(taskId, result, sanitizedPrompt, req);
        } else if (type === 'text-to-music') {
            let result;
            
            // Music generation is only supported through Kie.ai (Suno)
            // No need to specify provider - it's automatic
            const options = {};
            
            // Allow model selection and advanced options
            if (req.body.model) options.model = req.body.model;
            if (req.body.style) options.style = req.body.style;
            if (req.body.duration) options.duration = req.body.duration;
            if (req.body.genre) options.genre = req.body.genre;
            if (req.body.mood) options.mood = req.body.mood;
            if (req.body.tempo) options.tempo = req.body.tempo;
            if (req.body.instruments) options.instruments = req.body.instruments;
            if (req.body.vocalStyle) options.vocalStyle = req.body.vocalStyle;
            if (req.body.language) options.language = req.body.language;
            if (req.body.key) options.key = req.body.key;
            if (req.body.timeSignature) options.timeSignature = req.body.timeSignature;
            if (req.body.quality) options.quality = req.body.quality;
            if (req.body.customMode !== undefined) options.customMode = req.body.customMode;
            
            // Check if user specifically wants instrumental (optional)
            const isInstrumental = req.body.instrumental === true;
            const isAdvanced = req.body.advanced === true;
            
            console.log(`🎵 Generating ${isInstrumental ? 'instrumental' : 'vocal'} music ${isAdvanced ? 'with advanced V5 features' : ''}`);
            
            if (isAdvanced) {
                // Use advanced V5 mode with full control
                result = await musicService.generateAdvancedMusic(sanitizedPrompt, options);
            } else if (isInstrumental) {
                result = await musicService.generateInstrumentalMusic(sanitizedPrompt, options);
            } else {
                // Default: music with lyrics using automatic mode
                result = await musicService.generateMusicWithLyrics(sanitizedPrompt, options);
            }
            
            await finalizeMusic(taskId, result, sanitizedPrompt, req);
        } else if (type === 'gemini-chat') {
            let result;
            
            // Gemini text chat with conversation history
            const conversationHistory = req.body.conversationHistory || [];
            
            console.log(`🔮 Gemini chat processing`);
            result = await geminiService.generateTextResponse(sanitizedPrompt, conversationHistory);
            
            await finalizeTextResponse(taskId, result, sanitizedPrompt, req);
        } else if (type === 'openai-chat') {
            let result;
            
            // OpenAI text chat with conversation history
            const conversationHistory = req.body.conversationHistory || [];
            
            console.log(`🤖 Generating OpenAI chat response`);
            result = await openaiService.generateTextResponse(sanitizedPrompt, conversationHistory);
            
            await finalizeTextResponse(taskId, result, sanitizedPrompt, req);
        } else {
            await taskStore.set(taskId, { 
                status: 'error', 
                error: { message: 'Unsupported task type', type: type, supportedTypes: ['text-to-image', 'text-to-video', 'text-to-music', 'gemini-chat', 'openai-chat'] }
            });
        }
    } catch (error) {
        // Service already logs the error, just store it
        await taskStore.set(taskId, { status: 'error', error: error.message || error.toString() });
    }
});

router.get('/task-status/:taskId', async (req, res) => {
    const task = await taskStore.get(req.params.taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
});

async function finalizeTask(taskId, result, req, fileExtension = 'png') {
    try {
        if (isErrorResult(result)) {
            await taskStore.set(taskId, { status: 'error', ...result });
            return;
        }
        
        const filename = `${taskId}.${fileExtension}`;
        const outputDir = path.join(__dirname, '..', 'public', 'tmp');
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, filename);
        
        const buffer = result.imageBuffer || result.videoBuffer;
        
        if (buffer) {
            fs.writeFileSync(outputPath, buffer);
        } else {
            await taskStore.set(taskId, { status: 'error', error: { message: 'No buffer data', code: 'NO_BUFFER' } });
            return;
        }

        const host = `${req.protocol}://${req.get('host')}`;
        await taskStore.set(taskId, {
            status: 'done',
            result: `${host}/static/${filename}`,
            text: result.text,
            cost: result.cost
        });
    } catch (error) {
        console.error(`❌ Error in finalizeTask:`, error);
        await taskStore.set(taskId, { status: 'error', error: error.message || error.toString() });
    }
}

async function finalizeMusic(taskId, result, prompt, req) {
    try {
        if (isErrorResult(result)) {
            console.log(`❌ Music generation failed for task ${taskId}:`, result.error);
            await taskStore.set(taskId, { status: 'error', error: result.error });
            return;
        }
        
        const filename = `${taskId}.mp3`;
        const outputDir = path.join(__dirname, '..', 'public', 'tmp');
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, filename);
        
        if (result.audioBuffer) {
            fs.writeFileSync(outputPath, result.audioBuffer);
            console.log(`✅ Music file saved: ${filename}`);
        } else {
            console.error(`❌ No audio buffer in result for task ${taskId}`);
            await taskStore.set(taskId, { status: 'error', error: 'No audio buffer data' });
            return;
        }

        const host = `${req.protocol}://${req.get('host')}`;
        const taskResult = {
            status: 'done',
            result: `${host}/static/${filename}`,
            text: result.text || prompt,
            type: 'music'
        };

        // Add metadata if available
        if (result.metadata) {
            taskResult.metadata = {
                title: result.metadata.title,
                duration: result.metadata.duration,
                tags: result.metadata.tags,
                model: result.metadata.model,
                type: result.metadata.type
            };
        }

        await taskStore.set(taskId, taskResult);
        console.log(`✅ Music generation completed for task ${taskId}`);
        
    } catch (error) {
        console.error(`❌ Error in finalizeMusic:`, error);
        await taskStore.set(taskId, { status: 'error', error: error.message || error.toString() });
    }
}

async function finalizeTextResponse(taskId, result, prompt, req) {
    try {
        if (isErrorResult(result)) {
            console.log(`❌ Text generation failed for task ${taskId}:`, result.error);
            await taskStore.set(taskId, { status: 'error', error: result.error });
            return;
        }
        
        console.log(`✅ Text response generated for task ${taskId}`);
        
        const taskResult = {
            status: 'done',
            result: result.text || prompt,
            text: result.text || prompt,
            type: 'text'
        };

        // Add metadata if available
        if (result.metadata) {
            taskResult.metadata = {
                service: result.metadata.service,
                model: result.metadata.model,
                characterCount: result.metadata.characterCount,
                created_at: result.metadata.created_at
            };
        }

        // Add original prompt for reference
        if (result.originalPrompt) {
            taskResult.originalPrompt = result.originalPrompt;
        }

        await taskStore.set(taskId, taskResult);
        console.log(`📋 Task ${taskId} completed successfully`);
    } catch (error) {
        console.error(`❌ Error in finalizeTextResponse:`, error);
        await taskStore.set(taskId, { status: 'error', error: error.message || error.toString() });
    }
}

module.exports = router;