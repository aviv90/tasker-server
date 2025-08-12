/**
 * Text sanitization utility for handling special characters in API requests
 */

function sanitizeText(text) {
    if (!text || typeof text !== 'string') {
        return text;
    }
    
    // Remove null bytes and other control characters (except newlines and tabs)
    let sanitized = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    
    // Normalize Unicode characters
    sanitized = sanitized.normalize('NFKC');
    
    // Remove or replace problematic characters that can break JSON
    sanitized = sanitized
        // Replace smart quotes with regular quotes
        .replace(/[\u201C\u201D]/g, '"')  // Left and right double quotes
        .replace(/[\u2018\u2019]/g, "'")  // Left and right single quotes
        // Replace em dash and en dash with regular dash
        .replace(/[\u2013\u2014]/g, '-')
        // Remove zero-width characters
        .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
        // Replace non-breaking space with regular space
        .replace(/\u00A0/g, ' ');
    
    // Trim excessive whitespace
    sanitized = sanitized.replace(/\s+/g, ' ').trim();
    
    // Limit length to prevent extremely long inputs
    const MAX_LENGTH = 10000;
    if (sanitized.length > MAX_LENGTH) {
        sanitized = sanitized.substring(0, MAX_LENGTH);
    }
    
    return sanitized;
}

function sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object') {
        return obj;
    }
    
    const sanitized = Array.isArray(obj) ? [] : {};
    
    for (const [key, value] of Object.entries(obj)) {
        const cleanKey = sanitizeText(key);
        
        if (typeof value === 'string') {
            sanitized[cleanKey] = sanitizeText(value);
        } else if (typeof value === 'object' && value !== null) {
            sanitized[cleanKey] = sanitizeObject(value);
        } else {
            sanitized[cleanKey] = value;
        }
    }
    
    return sanitized;
}

function validateAndSanitizePrompt(prompt) {
    if (!prompt) {
        throw new Error('Prompt is required');
    }
    
    if (typeof prompt !== 'string') {
        throw new Error('Prompt must be a string');
    }
    
    const sanitized = sanitizeText(prompt);
    
    if (!sanitized || sanitized.length === 0) {
        throw new Error('Prompt cannot be empty after sanitization');
    }
    
    // Check for minimum meaningful content
    if (sanitized.length < 3) {
        throw new Error('Prompt is too short');
    }
    
    return sanitized;
}

module.exports = {
    sanitizeText,
    sanitizeObject,
    validateAndSanitizePrompt
};
