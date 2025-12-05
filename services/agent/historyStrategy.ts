/**
 * History Strategy Service
 * 
 * Manages the decision logic for loading conversation history.
 * Determines if history is needed based on the user's prompt (Self-contained vs Context-dependent).
 * Handles the processing of history (e.g., moving leading bot messages to system context).
 */

import logger from '../../utils/logger';
import { getChatHistory } from '../../utils/chatHistoryService';

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
    async processHistory(chatId: string, prompt: string, useConversationHistory: boolean): Promise<HistoryStrategyResult> {
        let history: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
        let systemContextAddition = '';

        if (!useConversationHistory) {
            logger.info('🧠 [HistoryStrategy] Conversation history disabled for this request');
            return { shouldLoadHistory: false, history, systemContextAddition };
        }

        const trimmedPrompt = prompt.trim();

        // =============================================================================
        // STEP 1: Check if this is a SELF-CONTAINED request (doesn't need history)
        // =============================================================================
        const selfContainedPatterns = [
            // Media creation
            /^#?\s*(צור|create|generate|ייצר|צייר|draw|make)\s+(תמונה|image|וידאו|video|שיר|song|מוזיקה|music)/i,
            /^#?\s*(תמונה|image|וידאו|video|שיר|song)\s+(של|of|about)\s+/i,

            // Send links/location
            /^#?\s*(שלח|send|שלחי|שלחו)\s+(קישור|link|לינק|מיקום|location)/i,
            /^#?\s*(קישור|link|לינק|מיקום|location)\s+(ל|to|של|of|ב|in|באזור)/i,

            // Send links/location
            /^#?\s*(שלח|send|שלחי|שלחו)\s+(קישור|link|לינק|מיקום|location)/i,
            /^#?\s*(קישור|link|לינק|מיקום|location)\s+(ל|to|של|of|ב|in|באזור)/i,

            // Time/date queries
            /^#?\s*(מה השעה|what time|מה התאריך|what date|מה היום|what day)/i,

            // Google Drive search
            /^#?\s*(חפש|search).*(במסמכים|בקבצים|ב-?drive|in\s*drive|in\s*documents)/i,

            // Direct media requests
            /^#?\s*(שלח|send)\s+(תמונה|image|וידאו|video)\s+(של|of)\s+/i,

            // Scheduling/Reminders
            /^#?\s*(תזמן|schedule|remind|הזכר|תזכורת|set reminder)\s+/i,
            /^#?\s*(תזכיר|remind me)\s+(לי|to|that)\s+/i,
            /^#?\s*(שלח|send)\s+(הודעה|message).*(בעוד|in|at|ב-|ל-)\s+/i,
            /^#?\s*(בעוד|in)\s+\d+/i,

            // Group Creation
            /^#?\s*(צור|create|פתח|open|הקם|start|new)\s+(קבוצה|group)\s+/i,
            /^#?\s*(קבוצה|group)\s+(חדשה|new)\s+/i,

            // Image/Media Creation
            /^#?\s*(צור|create|generate|make|צייר|draw)\s+(תמונה|image|ציור|drawing)\s+/i,
            /^#?\s*(תמונה|image)\s+(של|of)\s+/i,

            // Poll Creation
            /^#?\s*(צור|create|עשה|make)\s+(סקר|poll)\s+/i,

            // Audio Mix/Voice Clone
            /^#?\s*(מיקס|mix|ערבב)\s+(אודיו|audio|שיר|song)\s+/i,
            /^#?\s*(שבט|clone)\s+(קול|voice)\s+/i,
            /^#?\s*(דבר|speak|say)\s+(בקול|with voice)\s+/i

            // Flight patterns removed to allow context for refinements
        ];

        // =============================================================================
        // STEP 2: Check if this is a CONTINUATION that NEEDS history
        // =============================================================================
        const needsHistoryPatterns = [
            // Short responses
            /^#?\s*(כן|לא|אוקיי|בסדר|טוב|נכון|yes|no|ok|okay|sure|right|exactly|בדיוק)\.?$/i,
            /^#?\s*(עכשיו|now|מחר|tomorrow|היום|today|בבוקר|morning|בערב|evening)\.?$/i,

            // Continuations
            /^#?\s*(עוד|תמשיך|continue|more|another|אחד נוסף|עוד אחד|תן עוד|give me more)$/i,
            /^#?\s*(מה עוד|what else|ומה עוד|and what else)/i,

            // Thanks/feedback
            /^#?\s*(תודה|thanks|thank you|מעולה|great|awesome|יופי|נהדר)\.?$/i,

            // References
            /(מה (ש)?אמרתי|what i said|מה (ש)?ציינתי|מה (ש)?דיברנו|מה (ש)?שאלתי)/i,
            /(קודם|earlier|before|לפני|previous|את זה|this one|אותו|the same)/i,
            /(כמו (ש)?|like (the)?|דומה ל|similar to)/i,

            // Questions about conversation
            /(מתי|when|איפה|where|למה|why|איך|how).*(אמרת|said|ציינת|mentioned|דיברנו|discussed)/i,

            // Retry - Strict start of string to avoid false positives in conversation
            /^#?\s*(שוב|again|נסה שוב|try again|חזור|repeat)\s*[.!]?$/i,

            // Clarifications
            /(מה התכוונת|what do you mean|לא הבנתי|didn't understand|תסביר|explain)/i
        ];

        const isSelfContained = selfContainedPatterns.some(p => p.test(trimmedPrompt));
        const needsHistory = needsHistoryPatterns.some(p => p.test(trimmedPrompt));

        let shouldLoadHistory = false;

        if (needsHistory) {
            shouldLoadHistory = true;
            logger.info('🧠 [HistoryStrategy] Continuation/reference detected - loading history');
        } else if (isSelfContained) {
            shouldLoadHistory = false;
            logger.info('🧠 [HistoryStrategy] Self-contained request detected - skipping history');
        } else {
            shouldLoadHistory = true;
            logger.info('🧠 [HistoryStrategy] Regular message - loading history');
        }

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
                                // Check for common Ack patterns (Hebrew & English)
                                const isAck =
                                    text.startsWith('יוצר') ||
                                    text.startsWith('מבצע') ||
                                    text.startsWith('חושב') ||
                                    text.startsWith('מנתח') ||
                                    text.startsWith('מחפש') ||
                                    text.startsWith('מתמלל') ||
                                    text.startsWith('מתרגם') ||
                                    text.includes('... ⚙️') ||
                                    text.includes('... 🎨') ||
                                    text.includes('... 🎬') ||
                                    text.includes('... 🔍');

                                if (isAck) {
                                    logger.debug(`🧠 [HistoryStrategy] Filtered out system Ack message: "${text.substring(0, 30)}..."`);
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
