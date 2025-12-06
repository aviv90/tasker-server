/**
 * Retry Tools - ACK Messages
 * Handles sending acknowledgment messages for retry operations
 */

import { getToolAckMessage } from '../../utils/ackUtils';
import logger from '../../../../utils/logger';
import { formatErrorForLogging } from '../../../../utils/errorHandler';
import { TIME } from '../../../../utils/constants';
import { getServices } from '../../utils/serviceLoader';

/**
 * Send specific ACK message for retry based on tool and provider
 * @param chatId - Chat ID
 * @param tool - Tool name being retried
 * @param provider - Provider to use (optional)
 * @param quotedMessageId - Quoted message ID (optional)
 */
export async function sendRetryAck(
    chatId: string,
    tool: string,
    provider: string | null | undefined,
    quotedMessageId: string | null = null
): Promise<void> {
    try {
        // Skip ACK for location (no ACK needed)
        if (tool === 'send_location') {
            return;
        }

        // Use centralized ACK message function (SSOT - Single Source of Truth)
        const ackMessage = getToolAckMessage(tool, provider || undefined);

        if (ackMessage) {
            logger.debug(`📢 [RETRY ACK] ${ackMessage}`);
            const { greenApiService } = getServices();
            await greenApiService.sendTextMessage(chatId, ackMessage, quotedMessageId || undefined, TIME.TYPING_INDICATOR);
        }
    } catch (error) {
        logger.error('❌ Error sending retry ACK:', formatErrorForLogging(error));
        // Don't throw - ACK failure shouldn't break retry
    }
}

/**
 * Send multi-step retry ACK with information about which steps are being retried
 */
export async function sendMultiStepRetryAck(
    chatId: string,
    stepNumbers: number[] | null,
    stepTools: string[] | null,
    totalSteps: number,
    filteredStepsCount: number,
    quotedMessageId: string | null
): Promise<void> {
    try {
        const { greenApiService } = getServices();

        let ackMessage = '';
        if (stepNumbers && stepNumbers.length > 0) {
            ackMessage = `🔄 חוזר על שלבים ${stepNumbers.join(', ')} מתוך ${totalSteps} שלבים...`;
        } else if (stepTools && stepTools.length > 0) {
            const toolTranslations: Record<string, string> = {
                'create_poll': 'סקר',
                'send_location': 'מיקום',
                'create_image': 'תמונה',
                'create_video': 'וידאו',
                'create_music': 'מוזיקה'
            };
            const toolNames = stepTools.map(t => toolTranslations[t] || t).join(', ');
            ackMessage = `🔄 חוזר על ${toolNames} (${filteredStepsCount} שלבים)...`;
        } else {
            ackMessage = `🔄 חוזר על כל השלבים (${filteredStepsCount} שלבים)...`;
        }

        await greenApiService.sendTextMessage(
            chatId,
            ackMessage,
            quotedMessageId || undefined,
            1000
        );
    } catch (error) {
        logger.error('❌ Error sending multi-step retry ACK:', formatErrorForLogging(error));
        // Don't throw - ACK failure shouldn't break retry
    }
}
