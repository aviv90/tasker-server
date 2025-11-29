/**
 * Service Loader (TypeScript)
 * Lazy load heavy providers to avoid circular dependencies and improve startup time.
 */

type GeminiService = typeof import('../../geminiService');
type OpenAIService = typeof import('../../openai');
type GrokService = typeof import('../../grokService');
type GreenApiService = typeof import('../../greenApiService');

let geminiService: GeminiService | null = null;
let openaiService: OpenAIService | null = null;
let grokService: GrokService | null = null;
let greenApiService: GreenApiService | null = null;

export interface LoadedServices {
  geminiService: GeminiService;
  openaiService: OpenAIService;
  grokService: GrokService;
  greenApiService: GreenApiService;
}

/**
 * Load services lazily (cached after first require)
 */
export function getServices(): LoadedServices {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  if (!geminiService) geminiService = require('../../geminiService');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  if (!openaiService) openaiService = require('../../openai');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  if (!grokService) grokService = require('../../grokService');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  if (!greenApiService) greenApiService = require('../../greenApiService');

  return {
    geminiService,
    openaiService,
    grokService,
    greenApiService
  } as LoadedServices;
}

