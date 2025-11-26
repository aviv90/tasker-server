import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { expensiveOperationLimiter } from '../middleware/rateLimiter';
import * as taskStore from '../store/taskStore';
import * as geminiService from '../services/geminiService';
import * as openaiService from '../services/openai';
import * as replicateService from '../services/replicateService';
import * as kieService from '../services/kieService';
import * as musicService from '../services/musicService';
import { validateAndSanitizePrompt } from '../utils/textSanitizer';
import { isErrorResult } from '../utils/errorHandler';
import { finalizeVideo } from '../utils/videoUtils';
import fs from 'fs';
import path from 'path';
import { getTempDir } from '../utils/tempFileUtils';
import logger from '../utils/logger';

const router = express.Router();

interface TaskRequestBody {
    type: string;
    prompt: string;
    provider?: string;
    model?: string;
    style?: string;
    duration?: number;
    genre?: string;
    mood?: string;
    tempo?: string;
    instruments?: string;
    vocalStyle?: string;
    language?: string;
    key?: string;
    timeSignature?: string;
    quality?: string;
    customMode?: boolean;
    instrumental?: boolean;
    advanced?: boolean;
    conversationHistory?: any[];
    [key: string]: any;
}

// Expensive operations (AI generation) - strict rate limiting
router.post('/start-task', expensiveOperationLimiter, async (req: Request, res: Response) => {
    const { type, prompt, provider, model } = req.body as TaskRequestBody;
    
    // Validate required fields
    if (!type || !prompt) {
        res.status(400).json({ 
            status: 'error', 
            error: { message: 'Missing type or prompt', code: 'MISSING_FIELDS' }
        });
        return;
    }

    // Validate and sanitize prompt
    let sanitizedPrompt: string;
    try {
        sanitizedPrompt = validateAndSanitizePrompt(prompt);
    } catch (validationError) {
        res.status(400).json({ 
            status: 'error', 
            error: validationError // Pass the entire error object
        });
        return;
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
            
            // Cast result to any to satisfy TS (VideoResult expected but result is inferred as unknown)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await finalizeVideo(taskId, result as any, sanitizedPrompt, req as any);
        } else if (type === 'text-to-music') {
            let result;
            
            // Music generation is only supported through Kie.ai (Suno)
            // No need to specify provider - it's automatic
            const options: Record<string, any> = {};
            
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
            
            logger.info(`🎵 Generating ${isInstrumental ? 'instrumental' : 'vocal'} music ${isAdvanced ? 'with advanced V5 features' : ''}`);
            
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
            
            logger.info(`🔮 Gemini chat processing`);
            result = await geminiService.generateTextResponse(sanitizedPrompt, conversationHistory);
            
            await finalizeTextResponse(taskId, result, sanitizedPrompt, req);
        } else if (type === 'openai-chat') {
            let result;
            
            // OpenAI text chat with conversation history
            const conversationHistory = req.body.conversationHistory || [];
            
            logger.info(`🤖 Generating OpenAI chat response`);
            result = await openaiService.generateTextResponse(sanitizedPrompt, conversationHistory);
            
            await finalizeTextResponse(taskId, result, sanitizedPrompt, req);
        } else {
            await taskStore.set(taskId, { 
                status: 'error', 
                error: `Unsupported task type: ${type}. Supported types: text-to-image, text-to-video, text-to-music, gemini-chat, openai-chat`
            });
        }
    } catch (error: any) {
        // Service already logs the error, just store it
        logger.error('❌ Error starting task:', { taskId, error: error.message || error.toString() });
        await taskStore.set(taskId, { status: 'error', error: error.message || error.toString() });
    }
});

router.get('/task-status/:taskId', async (req: Request, res: Response) => {
    if (!req.params.taskId) {
        res.status(400).json({ error: 'Missing taskId' });
        return;
    }
    const task = await taskStore.get(req.params.taskId);
    if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
    }
    res.json(task);
});

async function finalizeTask(taskId: string, result: any, req: Request, fileExtension = 'png') {
    try {
        if (isErrorResult(result)) {
            await taskStore.set(taskId, { status: 'error', ...result });
            return;
        }
        
        const filename = `${taskId}.${fileExtension}`;
        // Use centralized temp directory (SSOT with static route)
        const outputDir = getTempDir();
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, filename);
        
        const buffer = result.imageBuffer || result.videoBuffer;
        
        if (buffer) {
            fs.writeFileSync(outputPath, buffer);
        } else {
            await taskStore.set(taskId, { status: 'error', error: 'No buffer data (NO_BUFFER)' });
            return;
        }

        const host = `${req.protocol}://${req.get('host')}`;
        await taskStore.set(taskId, {
            status: 'done',
            result: `${host}/static/${filename}`,
            text: result.text,
            cost: result.cost
        });
    } catch (error: any) {
        logger.error(`❌ Error in finalizeTask: ${taskId}`, { error: error.message || error.toString() });
        await taskStore.set(taskId, { status: 'error', error: error.message || error.toString() });
    }
}

async function finalizeMusic(taskId: string, result: any, prompt: string, req: Request) {
    try {
        if (isErrorResult(result)) {
            logger.error(`❌ Music generation failed for task ${taskId}: ${result.error}`);
            await taskStore.set(taskId, { status: 'error', error: result.error });
            return;
        }
        
        const filename = `${taskId}.mp3`;
        // Use centralized temp directory (SSOT with static route)
        const outputDir = getTempDir();
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, filename);
        
        if (result.audioBuffer) {
            fs.writeFileSync(outputPath, result.audioBuffer);
            logger.info(`✅ Music file saved: ${filename}`);
        } else {
            logger.error(`❌ No audio buffer in result for task ${taskId}`);
            await taskStore.set(taskId, { status: 'error', error: 'No audio buffer data' });
            return;
        }

        const host = `${req.protocol}://${req.get('host')}`;
        const taskResult: any = {
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
        logger.info(`✅ Music generation completed for task ${taskId}`);
        
    } catch (error: any) {
        logger.error(`❌ Error in finalizeMusic: ${taskId}`, { error: error.message || error.toString() });
        await taskStore.set(taskId, { status: 'error', error: error.message || error.toString() });
    }
}

async function finalizeTextResponse(taskId: string, result: any, prompt: string, _req: Request) {
    try {
        if (isErrorResult(result)) {
            logger.error(`❌ Text generation failed for task ${taskId}: ${result.error}`);
            await taskStore.set(taskId, { status: 'error', error: result.error });
            return;
        }
        
        const taskResult: any = {
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
        logger.info(`📋 Task ${taskId} completed successfully`);
    } catch (error: any) {
        logger.error(`❌ Error in finalizeTextResponse: ${taskId}`, { error: error.message || error.toString() });
        await taskStore.set(taskId, { status: 'error', error: error.message || error.toString() });
    }
}

export default router;
