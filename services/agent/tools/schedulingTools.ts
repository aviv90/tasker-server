/**
 * Scheduling Tools
 * Tools for scheduling messages and reminders.
 */
import logger from '../../../utils/logger';

// Simple in-memory cache for deduplication (Idempotency)
const dedupCache = new Map<string, { timestamp: number, result: any }>();

export const schedule_message = {
    declaration: {
        name: 'schedule_message',
        description: 'Schedule a message. You MUST calculate the exact ISO 8601 time based on the user request and Current Time. Do NOT pass natural language.',
        parameters: {
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    description: 'The content of the message to be sent.'
                },
                time: {
                    type: 'string',
                    description: 'The EXACT time to send format ISO 8601 (e.g. 2025-01-01T15:00:00+02:00). Calc relative times (e.g. "in 5 mins") yourself.'
                },
                recipient: {
                    type: 'string',
                    description: 'Optional: The name of the contact or group to send the message to. If not provided, the message will be sent to the current chat. Use fuzzy search to find the best match.'
                }
            },
            required: ['message', 'time']
        }
    },
    execute: async (args: { message: string, time: string, recipient?: string }, context: { chatId: string }) => {
        // 🛡️ Idempotency Check
        // Prevent double scheduling if the agent calls the tool twice or requests overlap
        const dedupKey = `${context.chatId}:${args.message}:${args.time}:${args.recipient || 'self'}`;
        const cached = dedupCache.get(dedupKey);
        if (cached && Date.now() - cached.timestamp < 5000) {
            logger.info(`🔄 [Scheduling] Dedup hit for key: ${dedupKey}, returning cached result`);
            return cached.result;
        }

        try {
            // Lazy load container to avoid circular dependencies
            const { default: container } = await import('../../container');
            const groupService = await import('../../groupService');
            // Removed DateParser import (or keep only for display formatting if needed)
            const { DateParser } = await import('../../../utils/dateParser');

            let targetChatId = context.chatId;
            let recipientName = 'Current Chat';

            // If recipient is provided, try to resolve it
            if (args.recipient) {
                const contact = await groupService.findContactByName(args.recipient);
                if (contact) {
                    targetChatId = contact.contactId;
                    recipientName = contact.contactName;
                } else {
                    return {
                        success: false,
                        error: `Could not find contact or group named "${args.recipient}". Please try a different name.`
                    };
                }
            }

            const scheduledAt = new Date(args.time);

            if (isNaN(scheduledAt.getTime())) {
                return {
                    error: 'Invalid time format. Please provide a valid ISO 8601 date string.'
                };
            }


            const now = new Date();
            // Allow a buffer of 2 minutes for processing time
            const nowWithBuffer = new Date(now.getTime() - 120000);

            if (scheduledAt < nowWithBuffer) {
                return {
                    success: false,
                    error: `Cannot schedule a message in the past. Current time is ${now.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}, but you requested ${scheduledAt.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}. Please provide a future time.`
                };
            }

            // Add "Reminder:" prefix if sending to self (context.chatId)
            let finalMessage = args.message;
            if (targetChatId === context.chatId) {
                finalMessage = `⏰ תזכורת: ${args.message}`;
            }

            const task = await container.getService('scheduledTasks').scheduleMessage(
                targetChatId,
                finalMessage,
                scheduledAt
            );

            // Trigger immediate check to send the message right away if it's due now
            // This avoids waiting for the next polling interval (10s)
            container.getService('scheduledTasks').processDueTasks().catch((err: any) => {
                logger.error('Error in immediate task processing:', err);
            });

            const successMessage = targetChatId === context.chatId
                ? `✅ ההודעה תוזמנה בהצלחה! היא תישלח ב-${DateParser.format(task.scheduledAt)}`
                : `✅ ההודעה ל-${recipientName} תוזמנה בהצלחה! היא תישלח ב-${DateParser.format(task.scheduledAt)}`;

            const result = {
                success: true,
                taskId: task.id,
                scheduledAt: task.scheduledAt.toISOString(),
                message: successMessage
            };

            // Cache result for idempotency
            dedupCache.set(dedupKey, { timestamp: Date.now(), result });

            // Clean up old cache entries periodically (simple approach)
            if (dedupCache.size > 100) {
                for (const [key, value] of dedupCache.entries()) {
                    if (Date.now() - value.timestamp > 60000) dedupCache.delete(key);
                }
            }

            return result;
        } catch (error: any) {
            return {
                error: `Failed to schedule message: ${error.message}`
            };
        }
    }
};

export default {
    schedule_message
};
