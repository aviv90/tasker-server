import { Tool } from './types';

export const metaTools: Record<string, Tool> = {
    retry_last_command: {
        name: 'retry_last_command',
        category: 'meta',
        description: 'Retry last command with optional modifications',
        usage: ['נסה שוב', 'try again', '# שוב אבל...'],
        parameters: {
            modifications: { type: 'string', required: false, description: 'Changes to apply' }
        },
        historyContext: {
            ignore: false,
            reason: 'This tool REQUIRES history to understand what command to retry. Always use history when this tool is called.'
        }
    },

    retry_with_different_provider: {
        name: 'retry_with_different_provider',
        category: 'meta',
        description: 'Retry failed task with different AI provider',
        usage: ['Internal - called when tool fails'],
        parameters: {
            original_tool: { type: 'string', required: true, description: 'Tool that failed' },
            task_type: { type: 'string', required: true, description: 'Task type (image/video/music)' }
        },
        historyContext: {
            ignore: false,
            reason: 'This tool REQUIRES history to understand the failed task context. Always use history when this tool is called.'
        }
    },

    smart_execute_with_fallback: {
        name: 'smart_execute_with_fallback',
        category: 'meta',
        description: 'Execute with automatic fallback on failure',
        usage: ['Internal - resilient execution'],
        parameters: {},
        historyContext: {
            ignore: false,
            reason: 'This tool may need history to understand the task context. Use history when relevant to the execution.'
        }
    }
};
