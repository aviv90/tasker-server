/**
 * Command Utilities
 * Centralized logic for detecting and parsing commands (starting with #)
 */

export const COMMAND_PREFIX_REGEX = /^#\s+/;

/**
 * Check if text is a command (starts with # followed by whitespace)
 */
export function isCommand(text: string | null | undefined): boolean {
    if (!text || typeof text !== 'string') return false;
    return COMMAND_PREFIX_REGEX.test(text.trim());
}

/**
 * Extract prompt from command (remove # prefix)
 */
export function extractCommandPrompt(text: string): string {
    if (!text) return '';
    return text.trim().replace(COMMAND_PREFIX_REGEX, '').trim();
}
