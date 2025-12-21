/**
 * Centralized prompts configuration
 * All AI prompts in one place for easy maintenance and updates
 */

// Import from organized prompt modules
import { agentSystemInstruction, singleStepInstruction, openaiSystemInstruction, grokSystemInstruction, searchSystemInstruction, googleSearchSystemInstruction, googleSearchResponse, googleSearchExample } from './system';
import { multiStepPlanner } from './multiStep';
import { groupCreationParsingPrompt, ttsParsingPrompt, musicVideoParsingPrompt } from './parsing';
import { pollGenerationPrompt, locationMapsPrompt, locationGeneralPrompt, chatSummaryPrompt, translationPrompt, driveDocumentAnalysisPrompt, driveImageAnalysisPrompt } from './special';

const prompts = {
    // System prompts
    agentSystemInstruction,
    singleStepInstruction,
    openaiSystemInstruction,
    grokSystemInstruction,
    searchSystemInstruction,
    googleSearchSystemInstruction,
    googleSearchResponse,
    googleSearchExample,

    // Multi-step planning
    multiStepPlanner,

    // Parsing prompts
    groupCreationParsingPrompt,
    ttsParsingPrompt,
    musicVideoParsingPrompt,

    // Special purpose prompts
    pollGenerationPrompt,
    locationMapsPrompt,
    locationGeneralPrompt,
    chatSummaryPrompt,
    translationPrompt,
    driveDocumentAnalysisPrompt,
    driveImageAnalysisPrompt,

    /**
     * Language instructions mapping
     * These are used in system prompts to ensure responses match input language
     */
    languageInstructions: {
        'he': 'חשוב מאוד: עליך לענות בעברית בלבד. התשובה חייבת להיות בעברית, ללא מילים באנגלית אלא אם כן זה שם פרטי או מונח טכני שאין לו תרגום.',
        'en': 'IMPORTANT: You must respond in English only. The answer must be in English.',
        'ar': 'مهم جداً: يجب أن تجيب بالعربية فقط. يجب أن تكون الإجابة بالعربية.',
        'ru': 'Очень важно: вы должны отвечать только на русском языке. Ответ должен быть на русском языке.'
    } as Record<string, string>
};

// Export for ES modules
export default prompts;
