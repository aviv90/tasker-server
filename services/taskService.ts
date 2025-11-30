import { v4 as uuidv4 } from 'uuid';
import * as taskStore from '../store/taskStore';
import * as geminiService from './geminiService';
import * as openaiService from './openai';
import * as replicateService from './replicateService';
import * as kieService from './kieService';
import * as musicService from './musicService';
import { validateAndSanitizePrompt } from '../utils/textSanitizer';
import { isErrorResult } from '../utils/errorHandler';
import { finalizeVideo } from '../utils/videoUtils';
import fs from 'fs';
import path from 'path';
import { getTempDir } from '../utils/tempFileUtils';
import logger from '../utils/logger';
import { StartTaskRequest } from '../schemas/taskSchemas';

export class TaskService {

    async startTask(request: StartTaskRequest, req: any): Promise<string> {
        const { prompt } = request;

        // Validate and sanitize prompt
        const sanitizedPrompt = validateAndSanitizePrompt(prompt);

        const taskId = uuidv4();
        await taskStore.set(taskId, { status: 'pending' });

        // Start async processing
        this.processTask(taskId, request, sanitizedPrompt, req).catch(err => {
            logger.error('❌ Unhandled error in processTask:', { taskId, error: err.message || err.toString() });
            taskStore.set(taskId, { status: 'error', error: err.message || err.toString() });
        });

        return taskId;
    }

    private async processTask(taskId: string, request: StartTaskRequest, sanitizedPrompt: string, req: any) {
        const { type, provider, model } = request;

        try {
            if (type === 'text-to-image') {
                let result;
                if (provider === 'openai') {
                    result = await openaiService.generateImageWithText(sanitizedPrompt);
                } else {
                    result = await geminiService.generateImageWithText(sanitizedPrompt);
                }
                await this.finalizeTask(taskId, result, req, 'png');
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
                if (request.model) options.model = request.model;
                if (request.style) options.style = request.style;
                if (request.duration) options.duration = request.duration;
                if (request.genre) options.genre = request.genre;
                if (request.mood) options.mood = request.mood;
                if (request.tempo) options.tempo = request.tempo;
                if (request.instruments) options.instruments = request.instruments;
                if (request.vocalStyle) options.vocalStyle = request.vocalStyle;
                if (request.language) options.language = request.language;
                if (request.key) options.key = request.key;
                if (request.timeSignature) options.timeSignature = request.timeSignature;
                if (request.quality) options.quality = request.quality;
                if (request.customMode !== undefined) options.customMode = request.customMode;

                // Check if user specifically wants instrumental (optional)
                const isInstrumental = request.instrumental === true;
                const isAdvanced = request.advanced === true;

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

                await this.finalizeMusic(taskId, result, sanitizedPrompt, req);
            } else if (type === 'gemini-chat') {
                let result;

                // Gemini text chat with conversation history
                const conversationHistory = request.conversationHistory || [];

                logger.info(`🔮 Gemini chat processing`);
                result = await geminiService.generateTextResponse(sanitizedPrompt, conversationHistory);

                await this.finalizeTextResponse(taskId, result, sanitizedPrompt, req);
            } else if (type === 'openai-chat') {
                let result;

                // OpenAI text chat with conversation history
                const conversationHistory = request.conversationHistory || [];

                logger.info(`🤖 Generating OpenAI chat response`);
                result = await openaiService.generateTextResponse(sanitizedPrompt, conversationHistory);

                await this.finalizeTextResponse(taskId, result, sanitizedPrompt, req);
            } else {
                await taskStore.set(taskId, {
                    status: 'error',
                    error: `Unsupported task type: ${type}.`
                });
            }
        } catch (error: any) {
            logger.error('❌ Error processing task:', { taskId, error: error.message || error.toString() });
            await taskStore.set(taskId, { status: 'error', error: error.message || error.toString() });
        }
    }

    private async finalizeTask(taskId: string, result: any, req: any, fileExtension = 'png') {
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

    private async finalizeMusic(taskId: string, result: any, prompt: string, req: any) {
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

    private async finalizeTextResponse(taskId: string, result: any, prompt: string, _req: any) {
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
}

export const taskService = new TaskService();
