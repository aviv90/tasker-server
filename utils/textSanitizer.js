/**
 * Text sanitization utilities for safe AI generation
 */

function sanitizeText(text) {
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    // Remove dangerous characters and normalize
    return text
        .trim()
        .replace(/[\x00-\x08\x0E-\x1F\x7F]/g, '') // Remove control characters
        .replace(/\s+/g, ' ') // Normalize whitespace
        .substring(0, 2000); // Limit length
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
    validateAndSanitizePrompt
};