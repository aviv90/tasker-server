import logger from '../../utils/logger';
import { getChatHistory } from '../../utils/chatHistoryService';
import { ACK_PATTERNS } from './config/constants';

export interface HistoryStrategyResult {
    shouldLoadHistory: boolean;
    history: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
    systemContextAddition: string;
}

/**
 * Patterns for SELF-CONTAINED user requests that should be FILTERED from history
 * These requests are already completed - showing them in history makes LLM think they're pending
 * 
 * IMPORTANT: This is based on TOOLS_SKIP_HISTORY from toolHistoryConfig.ts
 */
const CREATION_REQUEST_PATTERNS = [
    // Image creation
    /^#?\s*(צור|שלח|תן|עשה|הכן)\s+(תמונה|תמונות|ציור|איור)/i,
    /^#?\s*(create|send|make|draw|generate)\s+(image|picture|drawing)/i,
    /^#?\s*תמונה\s+של/i,
    /^#?\s*שלח\s+\S+$/i,  // "שלח ארנב" - single word after שלח = likely image

    // Video creation
    /^#?\s*(צור|שלח|עשה|הכן)\s+(וידאו|סרטון|video)/i,
    /^#?\s*(create|make|generate)\s+video/i,

    // Sound effects
    /^#?\s*(צור|שלח|עשה|הכן)\s+(אפקט\s*קולי|צליל|sound)/i,
    /^#?\s*(create|make|generate)\s+sound\s*effect/i,

    // Music creation
    /^#?\s*(צור|שלח|עשה)\s+(שיר|מוזיקה|מנגינה)/i,
    /^#?\s*(create|make|generate)\s+(song|music)/i,

    // Amazon product (self-contained)
    /^#?\s*(שלח|תן|מצא)\s+(מוצר|פריט)/i,
    /^#?\s*(send|find|get)\s+(product|item)/i,
    /^#?\s*מוצר\s*(אקראי|מאמזון)/i,

    // Location (self-contained)
    /^#?\s*(שלח|תן)\s+מיקום/i,
    /^#?\s*send\s+location/i,

    // TTS (self-contained) 
    /^#?\s*(אמור|תגיד|תשמיע)\s+/i,
    /^#?\s*(say|speak)\s+/i,

    // Web search (self-contained)
    /^#?\s*(חפש|מצא|תן\s+לינק)/i,
    /^#?\s*(search|find|look\s+up)/i,
];

/**
 * Check if a message is a self-contained creation request
 * These should be filtered from history as they're already completed
 */
function isSelfContainedRequest(text: string): boolean {
    const trimmed = text.trim();
    return CREATION_REQUEST_PATTERNS.some(pattern => pattern.test(trimmed));
}

export class HistoryStrategy {

    /**
     * Determine if history should be loaded and process it if so.
     * @param chatId - Chat ID
     * @param prompt - User's prompt
     * @param useConversationHistory - Boolean flag from options
     * @returns HistoryStrategyResult
     */
    async processHistory(chatId: string, _prompt: string, useConversationHistory: boolean): Promise<HistoryStrategyResult> {
        let history: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
        let systemContextAddition = '';

        // If explicitly disabled by caller (e.g. for media analysis), respect it.
        if (!useConversationHistory) {
            logger.info('🧠 [HistoryStrategy] Conversation history disabled for this request');
            return { shouldLoadHistory: false, history, systemContextAddition };
        }

        const shouldLoadHistory = true;
        logger.info('🧠 [HistoryStrategy] Loading history (Always-On LLM-First Strategy)');

        if (shouldLoadHistory) {
            try {
                // Load 20 messages for context
                const historyResult = await getChatHistory(chatId, 20, { format: 'internal', useDbCache: true });

                if (historyResult.success && historyResult.messages.length > 0) {
                    let filteredCount = 0;

                    const rawHistory: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = historyResult.messages
                        .filter(msg => {
                            const text = msg.content.trim();

                            // Filter out system Ack messages (from bot)
                            if (msg.role === 'assistant') {
                                const isAck =
                                    ACK_PATTERNS.PREFIXES.some(prefix => text.startsWith(prefix)) ||
                                    ACK_PATTERNS.SUFFIXES_OR_EMOJIS.some(suffix => text.includes(suffix));

                                if (isAck) {
                                    return false;
                                }
                            }

                            // CRITICAL FIX: Filter out old self-contained creation requests from USER
                            // These requests are already completed - showing them makes LLM think they're pending
                            if (msg.role === 'user') {
                                if (isSelfContainedRequest(text)) {
                                    filteredCount++;
                                    return false;
                                }
                            }

                            return true;
                        })
                        .map(msg => ({
                            role: (msg.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
                            parts: [{ text: msg.content }]
                        }));

                    if (filteredCount > 0) {
                        logger.info(`🧠 [HistoryStrategy] Filtered ${filteredCount} self-contained creation requests from history`);
                    }

                    // Handle leading bot messages (Gemini requirement: history must start with user)
                    let validHistory = rawHistory;
                    let orphanedContext = '';

                    while (validHistory.length > 0 && validHistory[0] && validHistory[0].role === 'model') {
                        const msgText = validHistory[0].parts[0]?.text || '';
                        orphanedContext += `\n- "${msgText}"`;
                        validHistory = validHistory.slice(1);
                    }

                    if (orphanedContext) {
                        logger.info(`🧠 [HistoryStrategy] Moved leading 'model' messages to System Context`);
                        systemContextAddition = `\n\nIMPORTANT CONTEXT: The last thing(s) you (the AI) said to the user were:${orphanedContext}\nThe user is responding to this.`;
                    }

                    history = validHistory;
                    logger.info(`🧠 [HistoryStrategy] Using ${history.length} previous messages`);
                } else {
                    logger.debug('🧠 [HistoryStrategy] No previous messages found');
                }
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                logger.warn('⚠️ [HistoryStrategy] Failed to load history:', { error: errorMessage });
            }
        }

        return { shouldLoadHistory, history, systemContextAddition };
    }
}

export const historyStrategy = new HistoryStrategy();
