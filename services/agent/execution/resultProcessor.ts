import { cleanThinkingPatterns } from '../utils/agentHelpers';
import { cleanJsonWrapper } from '../../../utils/textSanitizer';
import logger from '../../../utils/logger';
import { AgentResult, ToolResult } from '../types';
import { AgentContextState as AgentContext } from './context';
import { extractQuotedMessageId } from '../../../utils/messageHelpers';

/**
 * Result Processor
 * Handles processing of the final agent response, including text cleaning and result object construction.
 */
export class ResultProcessor {
    /**
     * Process the final result from the agent loop
     */
    processResult(
        rawText: string,
        context: AgentContext,
        iterationCount: number
    ): AgentResult {
        // 1. Clean Thinking Patterns
        const text = cleanThinkingPatterns(rawText);

        // 2. Extract Assets (Latest)
        const latestImageAsset = context.generatedAssets.images.length > 0
            ? context.generatedAssets.images[context.generatedAssets.images.length - 1]
            : null;
        const latestVideoAsset = context.generatedAssets.videos.length > 0
            ? context.generatedAssets.videos[context.generatedAssets.videos.length - 1]
            : null;
        const latestAudioAsset = context.generatedAssets.audio && context.generatedAssets.audio.length > 0
            ? context.generatedAssets.audio[context.generatedAssets.audio.length - 1]
            : null;
        const latestPollAsset = context.generatedAssets.polls && context.generatedAssets.polls.length > 0
            ? context.generatedAssets.polls[context.generatedAssets.polls.length - 1]
            : null;

        // 3. Extract Location Info (Special Case)
        // Check if send_location was called
        const locationResult = context.previousToolResults['send_location'] as ToolResult | undefined;
        const latitude = locationResult?.latitude || null;
        const longitude = locationResult?.longitude || null;
        let locationInfo = locationResult?.locationInfo || locationResult?.data || null;

        // Clean JSON wrappers from locationInfo
        if (typeof locationInfo === 'string') {
            locationInfo = cleanJsonWrapper(locationInfo);
        }

        logger.debug(`🔍 [ResultProcessor] Extracted assets - Image: ${latestImageAsset?.url}, Video: ${latestVideoAsset?.url}, Audio: ${latestAudioAsset?.url}, Poll: ${latestPollAsset?.question}, Location: ${latitude}, ${longitude}`);

        // 4. Clean JSON wrappers from final text
        let finalText = context.suppressFinalResponse ? '' : cleanJsonWrapper(text);

        // 5. Fallback for Empty Response
        // If text is empty and no assets, something went wrong (e.g. only thinking pattern)
        if (!finalText && !latestImageAsset && !latestVideoAsset && !latestAudioAsset && !latestPollAsset && !latitude) {

            // Check if tools were used. If yes, we assume the tool did its job (or sent its own error) and we don't need a generic fallback.
            const hasToolCalls = context.toolCalls && context.toolCalls.length > 0;
            const hasToolResults = Object.keys(context.previousToolResults).length > 0;

            if (hasToolCalls || hasToolResults) {
                logger.debug('⚠️ [ResultProcessor] Final response empty but tools were used. Suppressing generic fallback.');
                // Leave finalText empty or set to null if cleaner
            } else {
                logger.warn('⚠️ [ResultProcessor] Final response is empty after cleaning thinking patterns. Using fallback.');
                // Try to use original text if available, or generic error
                // Note: rawText also contains thinking patterns, so we rely on the cleaned `text` variable
                // If `text` (cleaned) is empty, we fall back to generic error.
                finalText = text.trim() ? text : 'לא הצלחתי לנסח תשובה ברורה. אנא נסה שנית.';
            }
        }

        // 6. Get originalQuoteId
        const originalMessageId = extractQuotedMessageId({ context });

        // 7. Construct Result
        return {
            success: true,
            text: finalText,
            imageUrl: latestImageAsset?.url || null,
            imageCaption: latestImageAsset?.caption || '',
            videoUrl: latestVideoAsset?.url || null,
            videoCaption: latestVideoAsset?.caption || '',
            audioUrl: latestAudioAsset?.url || null,
            poll: (latestPollAsset as unknown as { question: string; options: string[] }) || null,
            latitude: latitude,
            longitude: longitude,
            locationInfo: locationInfo as string | null, // Ensure string type
            toolsUsed: Object.keys(context.previousToolResults),
            iterations: iterationCount,
            toolCalls: context.toolCalls,
            toolResults: context.previousToolResults,
            multiStep: false,
            alreadySent: false,
            suppressedFinalResponse: context.suppressFinalResponse || false,
            originalMessageId: originalMessageId || undefined
        };
    }
}

/**
 * Helper to process final text from multi-step execution
 */
export function processFinalText(stepResults: AgentResult[], _options: unknown): string {
    // Logic: Combine text from all steps, or assume the last step is the conclusion.
    // For now, we'll join them, but typically the last step has the answer.
    // If we have a specific "Conclusion" step, we might prioritize it.

    const texts = stepResults
        .map((res, index) => res.text ? `Step ${index + 1}: ${res.text}` : null)
        .filter(Boolean);

    if (texts.length === 0) return 'ביצעתי את המשימה.';

    return texts.join('\n\n');
}

export default new ResultProcessor();
