/**
 * Service Loader (TypeScript)
 * Lazy load heavy providers to avoid circular dependencies and improve startup time.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

type GeminiService = typeof import('../../geminiService');
type OpenAIService = typeof import('../../openai');
type GrokService = typeof import('../../grokService');
type GreenApiService = typeof import('../../greenApiService');

type ConversationManagerModule = typeof import('../../conversationManager');
type ConversationManager = ConversationManagerModule['default'];

let geminiService: GeminiService | null = null;
let openaiService: OpenAIService | null = null;
let grokService: GrokService | null = null;
let greenApiService: GreenApiService | null = null;
let conversationManager: ConversationManager | null = null;

export interface LoadedServices {
  geminiService: GeminiService;
  openaiService: OpenAIService;
  grokService: GrokService;
  greenApiService: GreenApiService;
  conversationManager: ConversationManager;
}

/**
 * Load services lazily (cached after first require)
 */
export function getServices(): LoadedServices {

  if (!geminiService) geminiService = require('../../geminiService');

  if (!openaiService) openaiService = require('../../openai');

  if (!grokService) grokService = require('../../grokService');

  if (!greenApiService) greenApiService = require('../../greenApiService');

  if (!conversationManager) conversationManager = require('../../conversationManager').default || require('../../conversationManager');

  return {
    geminiService,
    openaiService,
    grokService,
    greenApiService,
    conversationManager
  } as LoadedServices;
}

