import { AgentContextState } from '../execution/context';
import logger from '../../../utils/logger';

/**
 * Repairs truncated or malformed media URLs using the Agent Context.
 * LLMs often truncate long URLs (e.g., "https://example.com/very-long...") or miss them entirely.
 * This helper checks the Original Input stored in the context to recover the valid URL.
 */
export function repairMediaUrl(
    url: string | undefined,
    type: 'image' | 'video' | 'audio',
    context: AgentContextState
): string | undefined {
    const repairedUrl = url;

    // Validation criteria
    const isTruncated = url?.endsWith('...') || false;
    const isTooShort = (url?.length || 0) < 15; // suspiciously short for a media URL
    const missingProtocol = url ? !url.startsWith('http') : false;
    const isMissing = !url;

    if (isMissing || isTruncated || isTooShort || missingProtocol) {
        let contextUrl: string | undefined | null;

        if (type === 'image') contextUrl = context.originalInput?.imageUrl;
        else if (type === 'video') contextUrl = context.originalInput?.videoUrl;
        else if (type === 'audio') contextUrl = context.originalInput?.audioUrl;

        if (contextUrl) {
            if (!isMissing) {
                logger.warn(`🔧 [${type}_tool] Detected invalid/truncated URL "${url}". Repairing using context URL: "${contextUrl}"`);
            } else {
                logger.debug(`🔧 [${type}_tool] No URL provided. Using context URL: "${contextUrl}"`);
            }
            return contextUrl;
        } else {
            if (!isMissing) {
                logger.warn(`⚠️ [${type}_tool] Invalid URL "${url}" and no context URL found to repair it.`);
            }
        }
    }

    return repairedUrl;
}
