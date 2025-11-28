/**
 * Result Handling - Type Definitions
 * Shared types for result handling functionality
 */

export interface AgentResult {
    success?: boolean;
    error?: string;
    text?: string;
    imageUrl?: string;
    imageCaption?: string;
    videoUrl?: string;
    videoCaption?: string;
    audioUrl?: string;
    poll?: {
        question: string;
        options: string[];
    };
    latitude?: string;
    longitude?: string;
    locationInfo?: string;
    multiStep?: boolean;
    alreadySent?: boolean;
    toolsUsed?: string[];
    iterations?: number;
    originalMessageId?: string;
    toolResults?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface NormalizedInput {
    userText?: string;
    hasImage?: boolean;
    hasVideo?: boolean;
    hasAudio?: boolean;
    imageUrl?: string | null;
    videoUrl?: string | null;
    audioUrl?: string | null;
    quotedContext?: unknown;
    originalMessageId?: string;
    chatType?: string;
    language?: string;
    authorizations?: Record<string, boolean | null>;
    [key: string]: unknown;
}

export interface MediaSendResult {
    sent: boolean;
    textSent?: boolean;
}

