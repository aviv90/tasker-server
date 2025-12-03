import { Request } from 'express';
import { StartTaskRequest } from '../../../schemas/taskSchemas';
import * as musicService from '../../musicService';
import logger from '../../../utils/logger';
import { TaskStrategy, MusicTaskResult } from './types';
import * as taskStore from '../../../store/taskStore';
import { isErrorResult } from '../../../utils/errorHandler';
import fs from 'fs';
import path from 'path';
import { getTempDir } from '../../../utils/tempFileUtils';

export class TextToMusicStrategy implements TaskStrategy {
    async execute(_taskId: string, request: StartTaskRequest, sanitizedPrompt: string, _req: Request): Promise<MusicTaskResult> {
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
            return await musicService.generateAdvancedMusic(sanitizedPrompt, options) as unknown as MusicTaskResult;
        } else if (isInstrumental) {
            return await musicService.generateInstrumentalMusic(sanitizedPrompt, options) as unknown as MusicTaskResult;
        } else {
            return await musicService.generateMusicWithLyrics(sanitizedPrompt, options) as unknown as MusicTaskResult;
        }
    }

    async finalize(taskId: string, result: MusicTaskResult, req: Request, prompt: string): Promise<void> {
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
            logger.error(`❌ Error in TextToMusicStrategy.finalize: ${taskId}`, { error: error.message || error.toString() });
            await taskStore.set(taskId, { status: 'error', error: error.message || error.toString() });
        }
    }
}
