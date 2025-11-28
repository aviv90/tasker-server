/**
 * Retry Tools - Type Definitions
 * Shared types for retry functionality
 */

export interface RetryArgs {
  provider_override?: string;
  modifications?: string;
  step_numbers?: number[];
  step_tools?: string[];
}

export interface ToolContext {
  chatId?: string;
  originalInput?: {
    originalMessageId?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface LastCommand {
  tool: string;
  toolArgs?: {
    prompt?: string;
    text?: string;
    provider?: string;
    service?: string;
    edit_instruction?: string;
    image_url?: string;
    topic?: string;
    target_language?: string;
    language?: string;
    [key: string]: unknown;
  };
  args?: {
    prompt?: string;
    text?: string;
    provider?: string;
    service?: string;
    edit_instruction?: string;
    image_url?: string;
    topic?: string;
    target_language?: string;
    language?: string;
    [key: string]: unknown;
  };
  isMultiStep?: boolean;
  plan?: {
    steps: Array<{
      tool?: string;
      action?: string;
      parameters?: Record<string, unknown>;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  prompt?: string;
  result?: {
    translation?: string;
    translatedText?: string;
    prompt?: string;
    provider?: string;
    service?: string;
    imageUrl?: string;
    target_language?: string;
    language?: string;
    originalText?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ToolResult {
  success: boolean;
  data?: string;
  error?: string;
  lastTool?: string;
  lastArgs?: Record<string, unknown>;
}

