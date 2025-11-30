import { SUPPORTED_FORMATS } from './validation';

/**
 * Get available models and languages
 * @returns Available options
 */
export function getAvailableOptions(): {
    models: Array<{
        id: string;
        name: string;
        description: string;
        languages: string[];
    }>;
    supported_formats: string[];
    max_file_size: string;
    optimization_levels: Array<{
        level: number;
        description: string;
    }>;
} {
    return {
        models: [
            {
                id: 'scribe_v1',
                name: 'Scribe v1',
                description: 'ElevenLabs primary speech-to-text model',
                languages: ['auto', 'en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'tr', 'ru', 'nl', 'cs', 'ar', 'zh', 'ja', 'hi']
            },
            {
                id: 'scribe_v1_experimental',
                name: 'Scribe v1 Experimental',
                description: 'Experimental version with latest improvements',
                languages: ['auto', 'en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'tr', 'ru', 'nl', 'cs', 'ar', 'zh', 'ja', 'hi']
            }
        ],
        supported_formats: SUPPORTED_FORMATS,
        max_file_size: '25MB',
        optimization_levels: [
            { level: 0, description: 'No optimization (best quality)' },
            { level: 1, description: 'Light optimization' },
            { level: 2, description: 'Balanced optimization' },
            { level: 3, description: 'Aggressive optimization' },
            { level: 4, description: 'Maximum speed (lower quality)' }
        ]
    };
}
