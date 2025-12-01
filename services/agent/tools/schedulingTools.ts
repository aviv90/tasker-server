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

            const scheduledAt = new Date(args.time);

            if (isNaN(scheduledAt.getTime())) {
                return {
                    error: 'Invalid time format. Please use ISO 8601 format.'
                };
            }

            const now = new Date();
            if (scheduledAt < now) {
                return {
                    success: false,
                    error: `Cannot schedule a message in the past. Current time is ${now.toISOString()}, but you requested ${scheduledAt.toISOString()}. Please provide a future time.`
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
