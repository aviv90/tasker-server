import logger from '../../utils/logger';
import { getChatHistory } from '../../utils/chatHistoryService';
// ACK_PATTERNS removed - we no longer filter ACKs to preserve context

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

        // If explicitly disabled by caller (e.g. for media analysis), respect it.
        if (!useConversationHistory) {
            logger.info('🧠 [HistoryStrategy] Conversation history disabled for this request');
            return { shouldLoadHistory: false, history, systemContextAddition };
        }

        const shouldLoadHistory = true;
        logger.info('🧠 [HistoryStrategy] Loading history (Always-On LLM-First Strategy)');

        if (shouldLoadHistory) {
            try {
                // Use DB cache for fast retrieval (10 messages is optimal for cache usage)
                const historyResult = await getChatHistory(chatId, 10, { format: 'internal', useDbCache: true });

                if (historyResult.success && historyResult.messages.length > 0) {
                    const rawHistory: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = historyResult.messages
                        .map(msg => {
                            // Map role
                            const role = (msg.role === 'assistant' ? 'model' : 'user') as 'user' | 'model';

                            // Construct text content
                            let text = msg.content || '';

                            // If message has media metadata but no text, or just to reinforce, add [Media] marker
                            // This ensures the LLM knows a file was sent AND has the URL to use it
                            const metadata = msg.metadata || {};
                            const mediaIndicators = [];

                            if (metadata.hasImage || metadata.imageUrl) mediaIndicators.push(`[Image: ${metadata.imageUrl}]`);
                            if (metadata.hasVideo || metadata.videoUrl) mediaIndicators.push(`[Video: ${metadata.videoUrl}]`);
                            if (metadata.hasAudio || metadata.audioUrl) mediaIndicators.push(`[Audio: ${metadata.audioUrl}]`);

                            if (mediaIndicators.length > 0) {
                                if (text) {
                                    text += `\n${mediaIndicators.join(' ')}`;
                                } else {
                                    text = mediaIndicators.join(' ');
                                }
                            }

                            // Fallback for completely empty messages
                            if (!text.trim()) {
                                text = '[Empty message]';
                            }

                            return {
                                role,
                                parts: [{ text }]
                            };
                        });

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

                    // CRITICAL GUARDRAIL: Strong separator to prevent history hallucinations
                    // The LLM sometimes treats history as active tasks to resume. We must explicitly forbid this.
                    if (validHistory.length > 0) {
                        systemContextAddition += `\n\n🛑 HISTORY BOUNDARY 🛑
The conversation logic above this point represents PAST interactions.
The user's NEW message (the final one) is your ONLY current task.
1. DO NOT resume previous tasks found in history.
2. DO NOT re-schedule or re-execute actions from the past.
3. Treat history purely as memory/context, not as instructions.`;
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
