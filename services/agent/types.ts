/**
 * Agent Subsystem Types
 * Centralized type definitions for the Agent, preventing duplication across services.
 */

// Tool Call Structure
export interface ToolCall {
    tool: string;
    args: Record<string, unknown>;
    result?: unknown;
    timestamp?: number;
    success?: boolean;
    error?: string;
    [key: string]: unknown;
}

// Tool Result Structure
export interface ToolResult {
    success?: boolean;
    error?: string;
    data?: string;
    imageUrl?: string;
    imageCaption?: string;
    caption?: string;
    description?: string;
    revisedPrompt?: string;
    videoUrl?: string;
    videoCaption?: string;
    audioUrl?: string;
    poll?: {
        question: string;
        options: string[];
    };
    provider?: string;
    latitude?: number;
    longitude?: number;
    locationInfo?: string;
    suppressFinalResponse?: boolean;
    errorsAlreadySent?: boolean;
    textOnly?: boolean;
    [key: string]: unknown;
}

export interface ToolFunctionResponse {
    functionResponse: {
        name: string;
        response: {
            success?: boolean;
            error?: string;
            [key: string]: unknown;
        };
    };
}

import { AgentContextState } from './execution/context';
export { AgentContextState };

export interface AgentTool<TArgs = unknown> {
    name?: string;
    description?: string;
    declaration?: {
        name: string;
        description: string;
        parameters: {
            type: string;
            properties?: Record<string, unknown>;
            required?: string[];
        };
        [key: string]: unknown;
    };
    execute(args: TArgs, context: AgentContextState): Promise<ToolResult>;
}

export interface StepResult extends AgentResult {
    data?: string;
}


// Agent Plan Structure (for Multi-step)
export interface AgentPlan {
    plan: string[];
    currentStep: number;
    [key: string]: unknown;
}

// Agent Execution Result
export interface AgentResult {
    success: boolean;
    text?: string;
    toolCalls?: ToolCall[];
    originalMessageId?: string;
    multiStep?: boolean;
    plan?: AgentPlan;
    stepsCompleted?: number;
    totalSteps?: number;
    toolResults?: Record<string, unknown>;
    imageUrl?: string | null;
    imageCaption?: string;
    videoUrl?: string | null;
    videoCaption?: string;
    audioUrl?: string | null;
    poll?: { question: string; options: string[]; topic?: string;[key: string]: unknown } | null;
    latitude?: number | null;
    longitude?: number | null;
    locationInfo?: string | null;
    toolsUsed?: string[];
    iterations?: number;
    alreadySent?: boolean;
    suppressedFinalResponse?: boolean;
    error?: string;
    /** Flag to indicate this result is from a retry execution - prevents re-saving command */
    isRetryExecution?: boolean;
    [key: string]: unknown;
}

// Agent Configuration
export interface AgentConfig {
    model: string;
    maxIterations: number;
    timeoutMs: number;
    contextMemoryEnabled: boolean;
}

// Agent Input Options
export interface AgentInput {
    userText?: string;
    imageUrl?: string | null;
    videoUrl?: string | null;
    audioUrl?: string | null;
    quotedMessageId?: string | null;
    lastCommand?: unknown;
    originalMessageId?: string;
    hasImage?: boolean;
    hasVideo?: boolean;
    hasAudio?: boolean;
    quotedContext?: unknown;
    chatType?: 'group' | 'private' | 'unknown';
    language?: string;
    authorizations?: {
        media_creation: boolean;
        group_creation: boolean | null;
        voice_allowed: boolean | null;
    };
    senderData?: unknown;
    [key: string]: unknown;
}
