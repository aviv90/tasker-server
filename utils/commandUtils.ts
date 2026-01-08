/**
 * Command Utilities
 * Centralized logic for detecting and parsing commands (starting with #)
 */

// Regex for DETECTING a command.
// Matches:
// 1. Hash followed by whitespace (# command)
// 2. Hash followed by non-ASCII character (#תעשה) - for Hebrew/other languages where space might be omitted
// Does NOT match:
// 1. Hash followed by ASCII character/number (#tag, #1) - to avoid hashtags
export const COMMAND_DETECTION_REGEX = /^#(\s+|[^\x00-\x7F])/;

// Regex for STRIPPING the command prefix.
// Matches hash and any optional following whitespace.
export const COMMAND_STRIP_REGEX = /^#\s*/;

/**
 * Check if text is a command
 */
export function isCommand(text: string | null | undefined): boolean {
    if (!text || typeof text !== 'string') return false;
    return COMMAND_DETECTION_REGEX.test(text.trim());
}

/**
 * Extract prompt from command (remove # prefix)
 */
export function extractCommandPrompt(text: string): string {
    if (!text) return '';
    return text.trim().replace(COMMAND_STRIP_REGEX, '').trim();
}
