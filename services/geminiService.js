const axios = require('axios');

async function generateImageWithText(prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const body = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            responseModalities: ["TEXT", "IMAGE"]
        }
    };

    try {
        const res = await axios.post(url, body, {
            responseType: 'json',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!res?.data) {
            return { error: 'Empty response from Gemini' };
        }

        const candidates = res.data.candidates;
        if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
            const msg = res.data.promptFeedback?.blockReasonMessage || 'No candidates returned';
            return { error: msg };
        }

        const parts = candidates[0]?.content?.parts;
        if (!parts || !Array.isArray(parts)) {
            return { error: 'No content parts in response' };
        }

        const textPart = parts.find(p => p.text);
        const text = textPart?.text || '';

        const imgPart = parts.find(p => p.inlineData?.data);
        if (!imgPart) {
            return { error: 'No inlineData image found' };
        }

        const imageBuffer = Buffer.from(imgPart.inlineData.data, 'base64');

        return { text, imageBuffer };

    } catch (err) {
        return { error: err?.message || 'Unknown exception during Gemini call' };
    }
}

module.exports = { generateImageWithText };