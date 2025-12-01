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
                const israelTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', timeZoneName: 'shortOffset' });
                const offsetMatch = israelTime.match(/GMT([+-]\d+)/);
                if (offsetMatch && offsetMatch[1]) {
                    const offset = offsetMatch[1]; // e.g., +3 or +2
                    // Pad with 0 if needed (e.g., +03:00)
                    const sign = offset.startsWith('-') ? '-' : '+';
                    const hours = Math.abs(parseInt(offset)).toString().padStart(2, '0');
                    timeStr += `${sign}${hours}:00`;
                } else {
                    // Fallback to +02:00 if detection fails (standard Israel time)
                    timeStr += '+02:00';
                }
            }

            const scheduledAt = new Date(timeStr);

            if (isNaN(scheduledAt.getTime())) {
                return {
                    error: 'Invalid time format. Please use ISO 8601 format.'
                };
            }

            const now = new Date();
            // Allow a small buffer (e.g., 1 minute) for processing time to avoid rejecting "now" requests
            const nowWithBuffer = new Date(now.getTime() - 60000);

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
