/**
 * Music service types
 */

import MusicTasksRepository from '../../repositories/musicTasksRepository';

/**
 * Music service interface
 */
export interface MusicService {
    baseUrl: string;
    headers: Record<string, string>;
    musicTasksRepository: MusicTasksRepository;
}

/**
 * Music generation options
 */
export interface MusicOptions {
    prompt: string;
    customMode?: boolean;
    instrumental?: boolean;
    model?: string;
    callBackUrl?: string;
    style?: string;
    title?: string;
    tags?: string[];
    duration?: number;
    genre?: string;
    mood?: string;
    tempo?: string;
    instruments?: string[];
    vocalStyle?: string;
    language?: string;
    key?: string;
    timeSignature?: string;
    quality?: string;
    stereo?: boolean;
    sampleRate?: number;
}

/**
 * Task information structure
 */
export interface TaskInfo {
    taskId: string;
    type: string;
    musicOptions?: MusicOptions;
    timestamp: number;
    whatsappContext?: {
        chatId: string;
        originalMessageId?: string;
        senderName?: string;
    } | null;
    wantsVideo?: boolean;
}

/**
 * Music generation options for public API
 */
export interface MusicGenerationOptions {
    whatsappContext?: {
        chatId: string;
        originalMessageId?: string;
        senderName?: string;
    } | null;
    makeVideo?: boolean;
    model?: string;
    style?: string;
    title?: string;
    tags?: string[];
    duration?: number;
    customMode?: boolean;
    instrumental?: boolean;
    genre?: string;
    mood?: string;
    tempo?: string;
    instruments?: string[];
    vocalStyle?: string;
    language?: string;
    key?: string;
    timeSignature?: string;
    quality?: string;
    stereo?: boolean;
    sampleRate?: number;
    prompt?: string;
    inputType?: 'description' | 'lyrics';
}

/**
 * Generation result
 */
export interface GenerationResult {
    taskId?: string;
    status?: string;
    message?: string;
    error?: string;
}

/**
 * Upload result
 */
export interface UploadResult {
    uploadUrl?: string;
    callbackUrl?: string;
    error?: string;
}
