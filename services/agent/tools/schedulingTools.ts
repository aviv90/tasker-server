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
        description: 'Schedule a message to be sent at a specific time. Use this when the user asks to be reminded or to send a message later. The time must be in ISO 8601 format (e.g., 2023-12-25T14:30:00+02:00).',
        parameters: {
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    description: 'The content of the message to be sent.'
                },
                time: {
                    type: 'string',
                    description: 'The time to send the message in ISO 8601 format (e.g., 2023-12-25T14:30:00+02:00).'
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
            const { parseScheduledTime } = await import('../../../utils/dateUtils');

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

            const scheduledAt = parseScheduledTime(args.time);

            if (!scheduledAt) {
                return {
                    error: 'Invalid time format. Please use ISO 8601 format.'
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
                ? `✅ ההודעה תוזמנה בהצלחה! היא תישלח ב-${task.scheduledAt.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`
                : `✅ ההודעה ל-${recipientName} תוזמנה בהצלחה! היא תישלח ב-${task.scheduledAt.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`;

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
