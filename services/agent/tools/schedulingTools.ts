/**
 * Scheduling Tools
 * Tools for scheduling messages and reminders.
 */

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
        try {
            // Lazy load container to avoid circular dependencies
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const container = require('../../container').default;
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const groupService = require('../../groupService');

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

            let timeStr = args.time;

            // If the time string doesn't have a timezone offset (Z or +HH:mm or -HH:mm), assume Israel time
            // ISO 8601 basic format: YYYY-MM-DDTHH:mm:ss
            if (!timeStr.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(timeStr)) {
                // Get current offset for Asia/Jerusalem
                // We use a fixed offset of +03:00 (IDT) or +02:00 (IST) based on simple heuristic or just default to +03:00 for now if detection fails
                // Better approach: Use Intl to get the offset part
                try {
                    const parts = new Intl.DateTimeFormat('en-US', {
                        timeZone: 'Asia/Jerusalem',
                        timeZoneName: 'longOffset'
                    }).formatToParts(new Date());

                    const offsetPart = parts.find(p => p.type === 'timeZoneName');
                    if (offsetPart && offsetPart.value.includes('GMT')) {
                        const offset = offsetPart.value.replace('GMT', '').trim(); // e.g., "+03:00"
                        timeStr += offset;
                    } else {
                        timeStr += '+02:00'; // Fallback
                    }
                } catch (e) {
                    timeStr += '+02:00'; // Fallback
                }
            }

            const scheduledAt = new Date(timeStr);

            if (isNaN(scheduledAt.getTime())) {
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
                console.error('Error in immediate task processing:', err);
            });

            const successMessage = targetChatId === context.chatId
                ? `✅ ההודעה תוזמנה בהצלחה! היא תישלח ב-${task.scheduledAt.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`
                : `✅ ההודעה ל-${recipientName} תוזמנה בהצלחה! היא תישלח ב-${task.scheduledAt.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`;

            return {
                success: true,
                taskId: task.id,
                scheduledAt: task.scheduledAt.toISOString(),
                message: successMessage
            };
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
