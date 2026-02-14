/**
 * Prompt Cleaner Utility
 * Cleans context markers from prompts that may leak from conversation history.
 * Shared across image and video creation tools.
 */

/**
 * Clean prompt from context markers that may leak from conversation history
 * @param prompt - Raw prompt text from LLM
 * @returns Cleaned prompt suitable for API calls
 */
export function cleanPromptFromContext(prompt: string): string {
    return prompt
        // Remove quoted message markers
        .replace(/\[הודעה מצוטטת:[^\]]*\]/g, '')
        .replace(/\[בקשה נוכחית:\]/g, '')
        // Remove IMPORTANT instructions meant for LLM
        .replace(/\*\*IMPORTANT:[^*]*\*\*/g, '')
        .replace(/\*\*CRITICAL:[^*]*\*\*/g, '')
        // Remove image_url/video_url instructions
        .replace(/Use this image_url parameter directly:[^\n]*/gi, '')
        .replace(/Use this video_url parameter directly:[^\n]*/gi, '')
        .replace(/image_url: "[^"]*"/gi, '')
        .replace(/video_url: "[^"]*"/gi, '')
        // Remove analysis/edit instructions meant for tool selection
        .replace(/- For analysis\/questions[^-]*/gi, '')
        .replace(/- For edits[^-]*/gi, '')
        .replace(/- DO NOT use retry_last_command[^*]*/gi, '')
        // Clean up whitespace
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
