import { StartTaskRequest } from '../../../schemas/taskSchemas';
import * as musicService from '../../musicService';
import logger from '../../../utils/logger';
import { TaskStrategy } from './types';

export class TextToMusicStrategy implements TaskStrategy {
    async execute(_taskId: string, request: StartTaskRequest, sanitizedPrompt: string, _req: any): Promise<any> {
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
            return await musicService.generateAdvancedMusic(sanitizedPrompt, options);
        } else if (isInstrumental) {
            return await musicService.generateInstrumentalMusic(sanitizedPrompt, options);
        } else {
            return await musicService.generateMusicWithLyrics(sanitizedPrompt, options);
        }
    }

    async finalize(_taskId: string, _result: any, _req: any, _prompt: string): Promise<void> {
        // Music finalization logic will be called by TaskService using this result
    }
}
