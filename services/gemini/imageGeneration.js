/**
 * Gemini Image Generation & Editing
 * 
 * Image creation, editing, and analysis using Gemini AI.
 * Extracted from gemini/core.js (Phase 4.5)
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { sanitizeText } = require('../../utils/textSanitizer');
const { getStaticFileUrl } = require('../../utils/urlUtils');
const { getGeminiErrorMessage } = require('./utils');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generateImageWithText(prompt) {
    try {
        console.log('🎨 Starting Gemini image generation');
        
        // Sanitize prompt as an extra safety measure
        let cleanPrompt = sanitizeText(prompt);
        
        // Remove image creation instructions from prompt (Gemini Image gets confused by them)
        // Hebrew patterns: "לצייר תמונה של", "צייר תמונה של", "צור תמונה של", "הפוך לתמונה את", etc.
        // English patterns: "draw image of", "create image of", "make image of", etc.
        cleanPrompt = cleanPrompt
            .replace(/^(ל)?(צייר|צור|הפוך|צרי|תצייר|תצור)\s+(תמונה\s+)?(של\s+)?/i, '')
            .replace(/^(to\s+)?(draw|create|make|generate|produce)\s+(an?\s+)?(image|picture|photo)\s+(of\s+)?/i, '')
            .trim();
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash-image-preview" 
        });
        
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: cleanPrompt }] }],
            generationConfig: { 
                responseModalities: ["IMAGE", "TEXT"], // Allow both - Gemini can add description/caption
                temperature: 0.7
            }
        });
        
        const response = result.response;
        
        if (!response.candidates || response.candidates.length === 0) {
            console.log('❌ Gemini: No candidates returned');
            const errorMsg = getGeminiErrorMessage(null, response.promptFeedback);
            return { error: errorMsg };
        }
        
        const cand = response.candidates[0];
        let text = '';
        let imageBuffer = null;
        
        // Check if content and parts exist
        if (!cand.content || !cand.content.parts) {
            console.log('❌ Gemini: No content or parts found in candidate');
            console.log('   Full candidate:', JSON.stringify(cand));
            const errorMsg = getGeminiErrorMessage(cand);
            return { error: errorMsg };
        }
        
        // Process all parts in the response
        for (const part of cand.content.parts) {
            if (part.text) {
                text += part.text;
            } else if (part.inlineData?.data) {
                imageBuffer = Buffer.from(part.inlineData.data, 'base64');
            }
        }
        
        if (!imageBuffer) {
            console.log('❌ Gemini: No image data found in response');
            
            // If we got text instead, it means Gemini failed to generate image
            if (text && text.trim().length > 0) {
                console.log('📝 Gemini returned text instead of image - generation failed');
                console.log(`   Gemini response: ${text.substring(0, 200)}...`);
                return { 
                    error: 'Gemini לא הצליח ליצור תמונה. נסה prompt אחר או השתמש ב-OpenAI במקום.'
                };
            }
            
            return { error: 'No image or text data found in response' };
        }
        
        console.log('✅ Gemini image generated successfully');
        return { text: text || prompt, imageBuffer };
    } catch (err) {
        console.error('❌ Gemini image generation error:', err);
        // Throw the error so it gets caught by the route's catch block
        throw err;
    }
}
async function generateImageForWhatsApp(prompt, req = null) {
    try {
        console.log('🎨 Starting Gemini image generation');
        
        // Sanitize prompt as an extra safety measure
        let cleanPrompt = sanitizeText(prompt);
        
        // Remove image creation instructions from prompt (Gemini Image gets confused by them)
        // Hebrew patterns: "לצייר תמונה של", "צייר תמונה של", "צור תמונה של", "הפוך לתמונה את", etc.
        // English patterns: "draw image of", "create image of", "make image of", etc.
        cleanPrompt = cleanPrompt
            .replace(/^(ל)?(צייר|צור|הפוך|צרי|תצייר|תצור)\s+(תמונה\s+)?(של\s+)?/i, '')
            .replace(/^(to\s+)?(draw|create|make|generate|produce)\s+(an?\s+)?(image|picture|photo)\s+(of\s+)?/i, '')
            .trim();
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash-image-preview" 
        });
        
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: cleanPrompt }] }],
            generationConfig: { 
                responseModalities: ["IMAGE", "TEXT"], // Allow text captions/descriptions alongside image
                temperature: 0.7
            }
        });
        
        
        const response = result.response;
        
        if (!response.candidates || response.candidates.length === 0) {
            console.log('❌ Gemini: No candidates returned');
            const errorMsg = getGeminiErrorMessage(null, response.promptFeedback);
            return { 
                success: false, 
                error: errorMsg
            };
        }
        
        const cand = response.candidates[0];
        let text = '';
        let imageBuffer = null;
        
        // Check if content and parts exist
        if (!cand.content || !cand.content.parts) {
            console.log('❌ Gemini: No content or parts found in candidate');
            console.log('   Full candidate:', JSON.stringify(cand));
            const errorMsg = getGeminiErrorMessage(cand);
            return { 
                success: false, 
                error: errorMsg
            };
        }
        
        // Process all parts in the response
        for (const part of cand.content.parts) {
            if (part.text) {
                text += part.text;
            } else if (part.inlineData?.data) {
                imageBuffer = Buffer.from(part.inlineData.data, 'base64');
            }
        }
        
        if (!imageBuffer) {
            console.log('❌ Gemini: No image data found in response');
            
            // If we got text instead, it means Gemini failed to edit/generate image
            // Return the text so the user knows what Gemini said
            if (text && text.trim().length > 0) {
                console.log('📝 Gemini returned text instead of image - edit/generation failed');
                console.log(`   Gemini response: ${text.substring(0, 200)}...`);
                return { 
                    success: false, 
                    error: text.trim()  // Return Gemini's actual response
                };
            }
            
            return { 
                success: false, 
                error: 'No image or text data found in response'
            };
        }
        
        // Save image to tmp folder and create accessible URL
        const fs = require('fs');
        const path = require('path');
        const { v4: uuidv4 } = require('uuid');
        
        const imageId = uuidv4();
        const fileName = `${imageId}.png`;
        const filePath = path.join(__dirname, '../..', 'public', 'tmp', fileName);
        
        // Ensure tmp directory exists
        const tmpDir = path.dirname(filePath);
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        
        // Write image file
        fs.writeFileSync(filePath, imageBuffer);
        
        // Create public URL using centralized URL utility
        const imageUrl = getStaticFileUrl(fileName, req);
        
        console.log('✅ Gemini image generated successfully');
        console.log(`🖼️ Image saved to: ${filePath}`);
        console.log(`🔗 Public URL: ${imageUrl}`);
        
        return { 
            success: true,
            imageUrl: imageUrl,
            description: text.trim() || "", // Send exactly what Gemini writes
            fileName: fileName
        };
    } catch (err) {
        console.error('❌ Gemini image generation error:', err);
        return { 
            success: false, 
            error: err.message || 'Unknown error occurred during image generation' 
        };
    }
}
async function editImageWithText(prompt, base64Image) {
    try {
        console.log('🖼️ Starting Gemini image editing');
        
        // Sanitize prompt as an extra safety measure
        const cleanPrompt = sanitizeText(prompt);
        
        // Detect user's language to ensure response matches input language
        const { detectLanguage } = require('../../utils/agentHelpers');
        const detectedLang = detectLanguage(cleanPrompt);
        
        // Build language instruction based on detected language
        let languageInstruction = '';
        switch (detectedLang) {
            case 'he':
                languageInstruction = '\n\nחשוב מאוד: עליך לענות בעברית בלבד. התשובה חייבת להיות בעברית, ללא מילים באנגלית אלא אם כן זה שם פרטי או מונח טכני שאין לו תרגום.';
                break;
            case 'en':
                languageInstruction = '\n\nIMPORTANT: You must respond in English only. The answer must be in English.';
                break;
            case 'ar':
                languageInstruction = '\n\nمهم جداً: يجب أن تجيب بالعربية فقط. يجب أن تكون الإجابة بالعربية.';
                break;
            case 'ru':
                languageInstruction = '\n\nОчень важно: вы должны отвечать только на русском языке. Ответ должен быть на русском языке.';
                break;
            default:
                languageInstruction = '\n\nחשוב מאוד: ענה בעברית בלבד.';
        }
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash-image-preview" 
        });
        
        const result = await model.generateContent({
            contents: [
                { role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: base64Image } }, { text: cleanPrompt + languageInstruction }] }
            ],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
        });
        
        const response = result.response;
        if (!response.candidates || response.candidates.length === 0) {
            console.log('❌ Gemini edit: No candidates returned');
            return { error: response.promptFeedback?.blockReasonMessage || 'No candidate returned' };
        }
        
        const cand = response.candidates[0];
        let text = '';
        let imageBuffer = null;
        
        // Log diagnostic info
        console.log(`   Finish reason: ${cand.finishReason}`);
        
        // Check if content and parts exist
        if (!cand.content || !cand.content.parts) {
            console.log('❌ Gemini edit: No content or parts found in candidate');
            console.log('   Full candidate:', JSON.stringify(cand));
            const errorMsg = getGeminiErrorMessage(cand);
            return { error: errorMsg };
        }
        
        // Process all parts in the response
        for (const part of cand.content.parts) {
            if (part.text) {
                text += part.text;
            } else if (part.inlineData?.data) {
                imageBuffer = Buffer.from(part.inlineData.data, 'base64');
            }
        }
        
        if (!imageBuffer) {
            console.log('❌ Gemini edit: No image data found in response');
            
            // If we got text instead, it means Gemini failed to generate image
            if (text && text.trim().length > 0) {
                console.log('📝 Gemini returned text instead of image - generation failed');
                console.log(`   Gemini response: ${text.substring(0, 200)}...`);
                return { 
                    error: 'Gemini לא הצליח ליצור תמונה. נסה prompt אחר או השתמש ב-OpenAI במקום.'
                };
            }
            
            return { error: 'No image or text data found in response' };
        }
        
        console.log('✅ Gemini image edited successfully');
        return { text: text || prompt, imageBuffer };
    } catch (err) {
        console.error('❌ Gemini image edit error:', err);
        // Throw the error so it gets caught by the route's catch block
        throw err;
    }
}
async function editImageForWhatsApp(prompt, base64Image, req) {
    try {
        console.log('🖼️ Starting Gemini image editing');
        
        // Sanitize prompt as an extra safety measure
        const cleanPrompt = sanitizeText(prompt);
        
        // Detect user's language to ensure response matches input language
        const { detectLanguage } = require('../../utils/agentHelpers');
        const detectedLang = detectLanguage(cleanPrompt);
        
        // Build language instruction based on detected language
        let languageInstruction = '';
        switch (detectedLang) {
            case 'he':
                languageInstruction = '\n\nחשוב מאוד: עליך לענות בעברית בלבד. התשובה חייבת להיות בעברית, ללא מילים באנגלית אלא אם כן זה שם פרטי או מונח טכני שאין לו תרגום.';
                break;
            case 'en':
                languageInstruction = '\n\nIMPORTANT: You must respond in English only. The answer must be in English.';
                break;
            case 'ar':
                languageInstruction = '\n\nمهم جداً: يجب أن تجيب بالعربية فقط. يجب أن تكون الإجابة بالعربية.';
                break;
            case 'ru':
                languageInstruction = '\n\nОчень важно: вы должны отвечать только на русском языке. Ответ должен быть на русском языке.';
                break;
            default:
                languageInstruction = '\n\nחשוב מאוד: ענה בעברית בלבד.';
        }
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash-image-preview" 
        });
        
        const result = await model.generateContent({
            contents: [
                { role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: base64Image } }, { text: cleanPrompt + languageInstruction }] }
            ],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
        });
        
        const response = result.response;
        if (!response.candidates || response.candidates.length === 0) {
            console.log('❌ Gemini edit: No candidates returned');
            console.log('   Prompt feedback:', JSON.stringify(response.promptFeedback));
            return { 
                success: false, 
                error: response.promptFeedback?.blockReasonMessage || 'No candidate returned' 
            };
        }
        
        const cand = response.candidates[0];
        let text = '';
        let imageBuffer = null;
        
        // Log detailed diagnostic info
        console.log(`   Finish reason: ${cand.finishReason}`);
        if (cand.safetyRatings) {
            console.log(`   Safety ratings:`, JSON.stringify(cand.safetyRatings));
        }
        
        // Check if content and parts exist
        if (!cand.content || !cand.content.parts) {
            console.log('❌ Gemini edit: No content or parts found in candidate');
            console.log('   Full candidate:', JSON.stringify(cand));
            
            // Check for safety/policy blocks
            if (cand.finishReason === 'SAFETY' || 
                cand.finishReason === 'IMAGE_SAFETY' || 
                cand.finishReason === 'RECITATION' || 
                cand.finishReason === 'PROHIBITED_CONTENT') {
                
                // Use finishMessage if available (contains the actual error)
                const errorMessage = cand.finishMessage || 
                    `Gemini blocked the request due to: ${cand.finishReason}. Try a different image or prompt.`;
                
                return { 
                    success: false, 
                    error: errorMessage
                };
            }
            
            // Check for other finish reasons with messages
            if (cand.finishMessage) {
                return { 
                    success: false, 
                    error: cand.finishMessage
                };
            }
            
            return { 
                success: false, 
                error: `Gemini returned no content (reason: ${cand.finishReason || 'unknown'})` 
            };
        }
        
        // Process all parts in the response
        for (const part of cand.content.parts) {
            if (part.text) {
                text += part.text;
            } else if (part.inlineData?.data) {
                imageBuffer = Buffer.from(part.inlineData.data, 'base64');
            }
        }
        
        if (!imageBuffer) {
            console.log('❌ Gemini edit: No image data found in response');
            console.log(`   Got text response (${text.length} chars): ${text.substring(0, 200)}...`);
            
            // If we got text instead, it means Gemini failed to edit image
            if (text && text.trim().length > 0) {
                console.log('📝 Gemini returned text instead of image - edit failed');
                return { 
                    success: false, 
                    error: 'Gemini לא הצליח לערוך את התמונה. נסה prompt אחר או השתמש ב-OpenAI במקום.'
                };
            }
            
            return { 
                success: false, 
                error: 'No image or text data found in response' 
            };
        }
        
        // Save to public directory
        const fileName = `gemini_edit_${uuidv4()}.png`;
        const filePath = path.join(__dirname, '../..', 'public', 'tmp', fileName);
        
        // Ensure tmp directory exists
        const tmpDir = path.dirname(filePath);
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        
        // Write image file
        fs.writeFileSync(filePath, imageBuffer);
        
        // Create public URL using centralized URL utility
        const imageUrl = getStaticFileUrl(fileName, req);
        
        console.log('✅ Gemini image edited successfully');
        console.log(`🖼️ Edited image saved to: ${filePath}`);
        console.log(`🔗 Public URL: ${imageUrl}`);
        
        return { 
            success: true,
            imageUrl: imageUrl,
            description: text.trim() || "", // Include text description from Gemini
            fileName: fileName
        };
    } catch (err) {
        console.error('❌ Gemini image edit error:', err);
        return { 
            success: false, 
            error: err.message || 'Unknown error occurred during image editing' 
        };
    }
}
async function analyzeImageWithText(prompt, base64Image) {
    try {
        console.log('🔍 Starting Gemini image analysis (text-only response)');
        
        // Sanitize prompt as an extra safety measure
        const cleanPrompt = sanitizeText(prompt);
        
        // Detect user's language using proper detection (not just Hebrew check)
        const { detectLanguage } = require('../../utils/agentHelpers');
        const detectedLang = detectLanguage(cleanPrompt);
        
        // Build language instruction based on detected language
        let languageInstruction = '';
        switch (detectedLang) {
            case 'he':
                languageInstruction = '\n\nחשוב מאוד: עליך לענות בעברית בלבד. התשובה חייבת להיות בעברית, ללא מילים באנגלית אלא אם כן זה שם פרטי או מונח טכני שאין לו תרגום.';
                break;
            case 'en':
                languageInstruction = '\n\nIMPORTANT: You must respond in English only. The answer must be in English.';
                break;
            case 'ar':
                languageInstruction = '\n\nمهم جداً: يجب أن تجيب بالعربية فقط. يجب أن تكون الإجابة بالعربية.';
                break;
            case 'ru':
                languageInstruction = '\n\nОчень важно: вы должны отвечать только на русском языке. Ответ должен быть на русском языке.';
                break;
            default:
                // Default to Hebrew for unknown languages
                languageInstruction = '\n\nחשוב מאוד: ענה בעברית בלבד.';
        }
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash" // Use regular model for text analysis
        });
        
        const result = await model.generateContent({
            contents: [
                { 
                    role: "user", 
                    parts: [
                        { inlineData: { mimeType: "image/jpeg", data: base64Image } }, 
                        { text: cleanPrompt + languageInstruction }
                    ] 
                }
            ],
            generationConfig: { 
                responseModalities: ["TEXT"], // Text-only response
                temperature: 0.7
            }
        });
        
        const response = result.response;
        if (!response.candidates || response.candidates.length === 0) {
            console.log('❌ Gemini image analysis: No candidates returned');
            return { 
                success: false, 
                error: response.promptFeedback?.blockReasonMessage || 'No candidate returned' 
            };
        }
        
        const cand = response.candidates[0];
        let text = '';
        
        // Extract text from response
        if (cand.content && cand.content.parts) {
            for (const part of cand.content.parts) {
                if (part.text) {
                    text += part.text;
                }
            }
        }
        
        if (!text || text.trim().length === 0) {
            console.log('❌ Gemini image analysis: No text found in response');
            return { 
                success: false, 
                error: 'No text response from Gemini' 
            };
        }
        
        console.log('✅ Gemini image analysis completed');
        return { 
            success: true,
            text: text.trim(),
            description: text.trim()
        };
    } catch (err) {
        console.error('❌ Gemini image analysis error:', err);
        return { 
            success: false, 
            error: err.message || 'Unknown error occurred during image analysis' 
        };
    }
}


module.exports = {
  generateImageWithText,
  generateImageForWhatsApp,
  editImageWithText,
  editImageForWhatsApp,
  analyzeImageWithText
};
