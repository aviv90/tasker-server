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
                }
            },
            required: ['message', 'time']
        }
    },
    execute: async (args: { message: string, time: string }, context: { chatId: string }) => {
        try {
            // Lazy load container to avoid circular dependencies
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const container = require('../../container').default;

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

            const task = await container.getService('scheduledTasks').scheduleMessage(
                context.chatId,
                args.message,
                scheduledAt
            );

            return {
                success: true,
                taskId: task.id,
                scheduledAt: task.scheduledAt.toISOString(),
                message: `Message scheduled for ${task.scheduledAt.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`
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
