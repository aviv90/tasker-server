/**
 * Shared types for creation tools
 * Single Source of Truth for creation tool types
 */

import { ProviderResult } from '../../../../utils/providerFallback';

/**
 * Agent tool context type
 */
export type AgentToolContext = {
  chatId?: string;
  expectedMediaType?: string | null;
  originalInput?: {
    userText?: string;
    language?: string;
    originalMessageId?: string;
    senderData?: {
      senderId?: string;
      sender?: string;
      senderName?: string;
      senderContactName?: string;
      chatName?: string;
    };
  };
  normalized?: {
    text?: string;
    language?: string;
  };
  [key: string]: unknown;
};

/**
 * Tool result type
 */
export type ToolResult = Promise<{
  success: boolean;
  data?: string;
  error?: string;
  [key: string]: unknown;
}>;

/**
 * Provider tagged result - extends ProviderResult with providerUsed
 */
export type ProviderTaggedResult = ProviderResult & {
  providerUsed?: string;
};

/**
 * Image provider result
 */
export type ImageProviderResult = ProviderTaggedResult & {
  imageUrl?: string;
  description?: string;
  revisedPrompt?: string;
  textOnly?: boolean;
  fileName?: string;
};

/**
 * Video provider result
 */
export type VideoProviderResult = ProviderTaggedResult & {
  videoUrl?: string;
  url?: string;
};

/**
 * Music generation response
 */
export type MusicGenerationResponse = {
  error?: string;
  status?: 'pending' | 'completed' | string;
  message?: string;
  taskId?: string;
  result?: string;
  url?: string;
  lyrics?: string;
};

/**
 * Create image arguments
 */
export type CreateImageArgs = {
  prompt?: string;
  provider?: 'gemini' | 'openai' | 'grok';
};

/**
 * Create video arguments
 */
export type CreateVideoArgs = {
  prompt?: string;
  provider?: 'veo3' | 'sora' | 'sora-pro' | 'kling';
};

/**
 * Image to video arguments
 */
export type ImageToVideoArgs = {
  image_url?: string;
  prompt?: string;
  provider?: 'veo3' | 'sora' | 'sora-pro' | 'kling';
};

/**
 * Create music arguments
 */
export type CreateMusicArgs = {
  prompt?: string;
  make_video?: boolean;
};

/**
 * Create poll arguments
 */
export type CreatePollArgs = {
  topic?: string;
  with_rhyme?: boolean;
  options?: unknown;
};

