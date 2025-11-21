/**
 * Text sanitization utilities for safe AI generation
 */

function sanitizeText(text) {
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    // Remove dangerous characters and normalize
    // NOTE: Preserves emojis and Unicode characters (including Hebrew, Arabic, etc.)
    return text
        .trim()
        .replace(/[\x00-\x08\x0E-\x1F\x7F]/g, '') // Remove control characters (but preserve emojis)
        .replace(/\s+/g, ' ') // Normalize whitespace
        .substring(0, 2000); // Limit length
}

/**
 * Clean markdown code blocks and formatting from text
 * Removes markdown code fences (```), inline code (`), and other markdown formatting
 * while preserving the actual content
 */
function cleanMarkdown(text) {
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    return text
        .replace(/```[\s\S]*?```/g, '') // Remove code blocks (```...```)
        .replace(/`[^`]*`/g, '') // Remove inline code (`...`)
        .replace(/^\s*```+\s*$/gm, '') // Remove standalone code fence lines
        .replace(/^\s*```+\s*/gm, '') // Remove opening code fences at start of lines
        .replace(/\s*```+\s*$/gm, '') // Remove closing code fences at end of lines
        .replace(/^\s*`+\s*$/gm, '') // Remove lines with only backticks
        .replace(/^\s*`+\s*/gm, '') // Remove leading backticks
        .replace(/\s*`+\s*$/gm, '') // Remove trailing backticks
        .trim();
}

/**
 * Clean media captions/descriptions from markdown, placeholders, and dangling link references
 * Used when sending generated images/videos/audio to WhatsApp
 */
function cleanMediaDescription(text) {
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    // Step 1: Clean markdown and URLs
    let cleaned = cleanMarkdown(text)
        .replace(/\[.*?\]\(https?:\/\/[^\)]+\)/g, '') // Remove markdown links
        .replace(/https?:\/\/[^\s]+/gi, '') // Remove plain URLs
        .replace(/\[image\]/gi, '')
        .replace(/\[video\]/gi, '')
        .replace(/\[audio\]/gi, '')
        .replace(/\[תמונה[^\]]*/gi, '') // Remove [תמונה: or [תמונה] with any text after (including incomplete brackets)
        .replace(/תמונה:\s*$/gi, '') // Remove תמונה: at the end of text
        .replace(/\[וידאו\]/gi, '')
        .replace(/\[אודיו\]/gi, '')
        .replace(/✅/g, '');
    
    // Step 2: Clean up whitespace
    cleaned = cleaned
        .replace(/\s{2,}/g, ' ')
        .trim();
    
    // Step 3: If nothing meaningful left, return empty string
    // (prevents sending messages with just punctuation or whitespace)
    if (cleaned.length < 3 || /^[^\w\u0590-\u05FF]+$/.test(cleaned)) {
        return '';
    }
    
    return cleaned;
}

function validateAndSanitizePrompt(prompt) {
    if (!prompt || typeof prompt !== 'string') {
        throw { message: 'Prompt is required and must be a string', code: 'INVALID_PROMPT' };
    }
    
    const sanitized = sanitizeText(prompt);
    
    if (sanitized.length < 3) {
        throw { message: 'Prompt must be at least 3 characters long', code: 'PROMPT_TOO_SHORT' };
    }
    
    if (sanitized.length > 2000) {
        throw { message: 'Prompt must be less than 2000 characters', code: 'PROMPT_TOO_LONG' };
    }
    
    // Check for potentially harmful content
    const bannedWords = ['hack', 'exploit', 'virus', 'malware'];
    const lowerPrompt = sanitized.toLowerCase();
    
    for (const word of bannedWords) {
        if (lowerPrompt.includes(word)) {
            throw { message: 'Prompt contains inappropriate content', code: 'INAPPROPRIATE_CONTENT' };
        }
    }
    
    return sanitized;
}

module.exports = {
    sanitizeText,
    validateAndSanitizePrompt,
    cleanMarkdown,
    cleanMediaDescription
};