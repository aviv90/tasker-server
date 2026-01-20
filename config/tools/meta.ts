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
    }
    // retry_with_different_provider REMOVED - NO AUTOMATIC FALLBACKS
    // smart_execute_with_fallback REMOVED - NO AUTOMATIC FALLBACKS
};
