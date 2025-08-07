const { GoogleGenerativeAI, GenerateContentConfig } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generateImageWithText(prompt) {
    try {
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash-preview-image-generation" 
        });
        
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
        });
        
        console.dir(result.response, { depth: null });
        
        const response = result.response;
        if (!response.candidates || response.candidates.length === 0) {
            return { error: response.promptFeedback?.blockReasonMessage || 'No candidate returned' };
        }
        
        const cand = response.candidates[0];
        let text = '';
        let imageBuffer = null;
        
        // Process all parts in the response
        for (const part of cand.content.parts) {
            if (part.text) {
                text += part.text;
            } else if (part.inlineData?.data) {
                imageBuffer = Buffer.from(part.inlineData.data, 'base64');
            }
        }
        
        if (!imageBuffer) {
            return { error: 'No image data found in response' };
        }
        
        return { text: text || prompt, imageBuffer };
    } catch (err) {
        console.error('❌ Gemini text-to-image error:', err.message);
        return { error: err.message };
    }
}

async function editImageWithText(prompt, base64Image) {
    try {
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash-preview-image-generation" 
        });
        
        const result = await model.generateContent({
            contents: [
                { role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: base64Image } }, { text: prompt }] }
            ],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
        });
        
        console.dir(result.response, { depth: null });
        
        const response = result.response;
        if (!response.candidates || response.candidates.length === 0) {
            return { error: response.promptFeedback?.blockReasonMessage || 'No candidate returned' };
        }
        
        const cand = response.candidates[0];
        let text = '';
        let imageBuffer = null;
        
        // Process all parts in the response
        for (const part of cand.content.parts) {
            if (part.text) {
                text += part.text;
            } else if (part.inlineData?.data) {
                imageBuffer = Buffer.from(part.inlineData.data, 'base64');
            }
        }
        
        if (!imageBuffer) {
            return { error: 'No image data found in response' };
        }
        
        return { text: text || prompt, imageBuffer };
    } catch (err) {
        console.error('❌ Gemini image-edit error:', err.message);
        return { error: err.message };
    }
}

module.exports = { generateImageWithText, editImageWithText };