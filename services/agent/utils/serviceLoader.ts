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

type ScheduledTasksService = typeof import('../../scheduling/scheduledTasksService').default;
type VoiceService = typeof import('../../voiceService').default;
type SpeechService = typeof import('../../speechService').default;
type AudioConverterService = typeof import('../../audioConverterService').default;

let geminiService: GeminiService | null = null;
let openaiService: OpenAIService | null = null;
let grokService: GrokService | null = null;
let greenApiService: GreenApiService | null = null;
let conversationManager: ConversationManager | null = null;
let scheduledTasks: ScheduledTasksService | null = null;

export interface LoadedServices {
  geminiService: GeminiService;
  openaiService: OpenAIService;
  grokService: GrokService;
  greenApiService: GreenApiService;
  conversationManager: ConversationManager;
  scheduledTasks: ScheduledTasksService;
  voiceService: VoiceService;
  speechService: SpeechService;
  audioConverterService: AudioConverterService;
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

  if (!scheduledTasks) {
    try {
      const container = require('../../container').default;
      if (container && typeof container.getService === 'function') {
        scheduledTasks = container.getService('scheduledTasks');
      }
    } catch (error) {
      // Ignore
    }
  }

  // Lazy load additional media services
  const voiceService = require('../../voiceService').default || require('../../voiceService');
  const speechService = require('../../speechService').default || require('../../speechService');
  const audioConverterService = require('../../audioConverterService').default || require('../../audioConverterService');

  return {
    geminiService,
    openaiService,
    grokService,
    greenApiService,
    conversationManager,
    scheduledTasks,
    voiceService,
    speechService,
    audioConverterService
  } as LoadedServices;
}

