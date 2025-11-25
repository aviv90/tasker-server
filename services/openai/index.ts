/**
 * OpenAI Service - Main Export
 * 
 * Centralized export for all OpenAI services.
 * Extracted from openaiService.js (Phase 5.3)
 */

// Import image functions
import {
    generateImageWithText,
    editImageWithText,
    generateImageForWhatsApp,
    editImageForWhatsApp
} from './image';

// Import text functions
import {
    generateTextResponse
} from './text';

// Import video functions
import {
    generateVideoWithSora,
    generateVideoWithSoraForWhatsApp,
    generateVideoWithSoraFromImageForWhatsApp
} from './video';

// Re-export all functions (maintains backward compatibility)
export {
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

