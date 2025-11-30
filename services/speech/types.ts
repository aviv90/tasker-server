/**
 * Speech Service Types
 */

export interface SpeechToTextOptions {
    model?: string;
    format?: string;
    language?: string | null;
    logging?: boolean;
    diarize?: boolean;
    numSpeakers?: number;
    tagAudioEvents?: boolean;
    [key: string]: unknown;
}

export interface TranscriptionResult {
    text?: string;
    result?: string;
    error?: string;
    metadata?: {
        service: string;
        model: string;
        language: string;
        confidence?: number | null;
        processing_time?: number | null;
        character_count: number;
        word_count: number;
        timestamp: string;
    };
}

export interface AudioFile {
    buffer: Buffer;
    filename?: string;
    options?: SpeechToTextOptions;
}

export interface BatchResult {
    results?: Array<{
        filename: string;
        text: string;
        metadata: TranscriptionResult['metadata'];
    }>;
    errors?: Array<{
        filename: string;
        error: string;
    }>;
    summary?: {
        total_files: number;
        successful: number;
        failed: number;
        total_characters: number;
        total_words: number;
    };
    error?: string;
}

export interface ValidationResult {
    valid: boolean;
    error?: string;
    size?: number;
    format?: string;
}

export interface TempFileResult {
    path?: string;
    filename?: string;
    size?: number;
    error?: string;
}

export interface TranscriptionResponse {
    text?: string;
    detected_language?: string;
    confidence?: number;
    processing_time_ms?: number;
}

export interface ErrorResponse {
    response?: {
        status?: number;
        data?: {
            detail?: string;
            message?: string;
        };
    };
}
