/**
 * Scheduling Tools
 * Tools for scheduling messages and reminders.
 */

import container from '../../container';

export const schedule_message = {
    name: 'schedule_message',
    description: 'Schedule a message to be sent at a specific time. Use this when the user asks to be reminded or to send a message later. The time must be in ISO 8601 format (e.g., 2023-12-25T14:30:00+02:00).',
    parameters: {
        type: 'OBJECT',
        properties: {
            message: {
                type: 'STRING',
                description: 'The content of the message to be sent.'
            },
            time: {
                type: 'STRING',
                description: 'The time to send the message in ISO 8601 format (e.g., 2023-12-25T14:30:00+02:00).'
            }
        },
        required: ['message', 'time']
    },
    function: async (args: { message: string, time: string }, context: { chatId: string }) => {
        try {
            const scheduledAt = new Date(args.time);

            if (isNaN(scheduledAt.getTime())) {
                return {
                    error: 'Invalid time format. Please use ISO 8601 format.'
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
