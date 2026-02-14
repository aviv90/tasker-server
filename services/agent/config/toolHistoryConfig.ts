/**
 * Tool History Configuration - SSOT
 * Defines which tools should skip conversation history
 * 
 * PRINCIPLE: LLM-first - no heuristics, just clear configuration
 * 
 * skipHistory: true = Tool is self-contained, doesn't need conversation context
 * skipHistory: false = Tool may need conversation history for context
 */

/**
 * Tools that SKIP history (self-contained requests)
 * These tools work independently without needing previous conversation context
 */
export const TOOLS_SKIP_HISTORY: readonly string[] = [
    // === CREATION TOOLS (always self-contained) ===
    'create_image',           // "צור תמונה של חתול" - doesn't need history
    'create_video',           // "צור וידאו של שקיעה" - doesn't need history
    'create_music',           // "צור שיר על אהבה" - doesn't need history
    'create_sound_effect',    // "צור צליל של פיצוץ" - doesn't need history
    'create_poll',            // "צור סקר על..." - topic is in request
    'create_group',           // "צור קבוצה בשם X" - doesn't need history

    // === EDITING TOOLS (media URL is provided) ===
    'edit_image',             // Image URL is in the request
    'edit_video',             // Video URL is in the request

    // === AUDIO/SPEECH TOOLS (text is in request) ===
    'text_to_speech',         // "אמור שלום" - text is in request
    'translate_text',         // "תרגם לאנגלית: שלום" - text is in request
    'translate_and_speak',    // "אמור שלום באנגלית" - text is in request

    // === SEARCH TOOLS (query is self-contained) ===
    'search_web',             // "חפש מידע על X" - query is in request
    'search_google_drive',    // "חפש ב-Drive את X" - query is in request
    'random_amazon_product',  // "מוצר אקראי" - no context needed
    'random_flight',          // "טיסה אקראית" - no context needed

    // === LOCATION TOOLS ===
    'send_location',          // "שלח מיקום באזור X" - region is in request

    // === SCHEDULING ===
    'schedule_message',       // "תזכיר לי בעוד שעה" - details in request
] as const;

/**
 * Tools that REQUIRE history (context-dependent requests)
 * These tools need conversation context to work properly
 */
export const TOOLS_REQUIRE_HISTORY: readonly string[] = [
    // === CONTEXT TOOLS (explicitly need history) ===
    'get_chat_history',           // Obviously needs history
    'chat_summary',               // Summarizes conversation - needs history
    'analyze_image_from_history', // Finds image in history
    'get_long_term_memory',       // Retrieves stored preferences
    'save_user_preference',       // May reference what user said

    // === RETRY/META TOOLS (need previous command context) ===
    'retry_last_command',             // Needs to know what was the last command
] as const;

/**
 * Tools with CONDITIONAL history (depends on input)
 * These may or may not need history depending on whether media URL is provided
 */
export const TOOLS_CONDITIONAL_HISTORY: readonly string[] = [
    // === ANALYSIS TOOLS ===
    // If media URL is provided in input → skip history
    // If media URL is missing → may need history to find it
    'analyze_image',          // Needs URL, might be in history
    'analyze_video',          // Needs URL, might be in history
    'transcribe_audio',       // Needs audio URL, might be in history

    // === MEDIA CONVERSION ===
    'image_to_video',         // Needs image URL, might be in history
    'voice_clone_and_speak',  // Needs reference audio, might be in history
    'creative_audio_mix',     // Needs audio files, might be in history
] as const;

/**
 * Check if a tool should skip history loading
 * @param toolName - Name of the tool
 * @param hasMediaInInput - Whether media is already provided in input
 * @returns true if history should be skipped
 */
export function shouldSkipHistoryForTool(toolName: string, hasMediaInInput: boolean = false): boolean {
    // Explicit skip
    if (TOOLS_SKIP_HISTORY.includes(toolName)) {
        return true;
    }

    // Explicit require
    if (TOOLS_REQUIRE_HISTORY.includes(toolName)) {
        return false;
    }

    // Conditional - skip if media is already in input
    if (TOOLS_CONDITIONAL_HISTORY.includes(toolName)) {
        return hasMediaInInput;
    }

    // Default: don't skip (safer to include history)
    return false;
}

/**
 * Get all tool names that skip history
 */
export function getToolsSkippingHistory(): string[] {
    return [...TOOLS_SKIP_HISTORY];
}

/**
 * Get all tool names that require history
 */
export function getToolsRequiringHistory(): string[] {
    return [...TOOLS_REQUIRE_HISTORY];
}
