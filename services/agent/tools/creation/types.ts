/**
 * Shared types for creation tools
 * Single Source of Truth for creation tool types
 */

import { ProviderResult } from '../../../../utils/providerFallback';
import { PROVIDERS } from '../../config/constants';
import { AgentContextState } from '../../types';

/**
 * Agent tool context type
 */
export type AgentToolContext = AgentContextState;

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
  description?: string;
  revisedPrompt?: string;
  caption?: string;
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
  provider?: typeof PROVIDERS.IMAGE.GEMINI | typeof PROVIDERS.IMAGE.OPENAI | typeof PROVIDERS.IMAGE.GROK;
};

/**
 * Create video arguments
 */
export type CreateVideoArgs = {
  prompt?: string;
  provider?: typeof PROVIDERS.VIDEO.VEO3 | typeof PROVIDERS.VIDEO.SORA | typeof PROVIDERS.VIDEO.SORA_PRO | typeof PROVIDERS.VIDEO.KLING;
};

/**
 * Image to video arguments
 */
export type ImageToVideoArgs = {
  image_url?: string;
  prompt?: string;
  provider?: typeof PROVIDERS.VIDEO.VEO3 | typeof PROVIDERS.VIDEO.SORA | typeof PROVIDERS.VIDEO.SORA_PRO | typeof PROVIDERS.VIDEO.KLING;
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

