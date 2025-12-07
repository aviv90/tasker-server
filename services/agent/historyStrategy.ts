import logger from '../../utils/logger';
import { getChatHistory } from '../../utils/chatHistoryService';
import { ACK_PATTERNS } from './config/constants';

export interface HistoryStrategyResult {
    shouldLoadHistory: boolean;
    history: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
    systemContextAddition: string;
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

        // If explicitly disabled by caller (e.g. for specific stateless tools), respect it.
        // Otherwise, we leverage the LLM's ability to discern context, so we DEFAULT TO TRUE.
        if (!useConversationHistory) {
            logger.info('🧠 [HistoryStrategy] Conversation history disabled for this request');
            return { shouldLoadHistory: false, history, systemContextAddition };
        }

        // HEURISTIC REMOVAL:
        // Previously, we used ~100 lines of Regex to guess if "history is needed".
        // Now, we rely on the LLM (Gemini 1.5) to handle context intelligently.
        // We always provide the last 20 messages. The cost is negligible, the gain is Contextual Intelligence.

        const shouldLoadHistory = true;
        logger.info('🧠 [HistoryStrategy] Loading history (Always-On LLM-First Strategy)');

        if (shouldLoadHistory) {
            try {
                // Use DB cache for fast retrieval (20 messages)
                const historyResult = await getChatHistory(chatId, 20, { format: 'internal', useDbCache: true });

                if (historyResult.success && historyResult.messages.length > 0) {
                    const rawHistory: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = historyResult.messages
                        .filter(msg => {
                            // Filter out system Ack messages to prevent hallucination/mimicking
                            if (msg.role === 'assistant') {
                                const text = msg.content.trim();
                                // Check for common Ack patterns (Hebrew & English) - Importing constants would be better but keeping simple for now
                                // TODO: Import TOOL_ACK_MESSAGES for robustness
                                // Use centralized patterns
                                const isAck =
                                    ACK_PATTERNS.PREFIXES.some(prefix => text.startsWith(prefix)) ||
                                    ACK_PATTERNS.SUFFIXES_OR_EMOJIS.some(suffix => text.includes(suffix));

                                if (isAck) {
                                    // logger.debug(`🧠 [HistoryStrategy] Filtered out system Ack message`);
                                    return false;
                                }
                            }
                            return true;
                        })
                        .map(msg => ({
                            role: (msg.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
                            parts: [{ text: msg.content }]
                        }));

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
