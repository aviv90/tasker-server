/**
 * OpenAI Service - Main Export
 * 
 * Centralized export for all OpenAI services.
 * Extracted from openaiService.js (Phase 5.3)
 */

// Import image functions
const {
    generateImageWithText,
    editImageWithText,
    generateImageForWhatsApp,
    editImageForWhatsApp
} = require('./image');

// Import text functions
const {
    generateTextResponse
} = require('./text');

// Import video functions
const {
    generateVideoWithSora,
    generateVideoWithSoraForWhatsApp,
    generateVideoWithSoraFromImageForWhatsApp
} = require('./video');

// Re-export all functions (maintains backward compatibility)
module.exports = {
    // Image functions
    generateImageWithText,
    editImageWithText,
    generateImageForWhatsApp,
    editImageForWhatsApp,
    
    // Text functions
    generateTextResponse,
    
    // Video functions
    generateVideoWithSora,
    generateVideoWithSoraForWhatsApp,
    generateVideoWithSoraFromImageForWhatsApp
};

