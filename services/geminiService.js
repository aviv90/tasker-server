const axios = require('axios');

async function generateImageWithText(prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const body = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
    };
    try {
        const res = await axios.post(url, body, {
            responseType: 'json', headers: { 'Content-Type': 'application/json' }
        });
        console.dir(res.data, { depth: null });
        const err = res.data.errors || res.data.error;
        if (err) return { error: Array.isArray(err) ? err[0].message : err.message };
        const cand = res.data.candidates?.[0];
        if (!cand) return { error: res.data.promptFeedback?.blockReasonMessage || 'No candidate returned' };
        const text = cand.content.parts.find(p => p.text)?.text || '';
        const part = cand.content.parts.find(p => p.inlineData?.data);
        if (!part) return { error: 'No inlineData image part' };
        const imageBuffer = Buffer.from(part.inlineData.data, 'base64');
        return { text, imageBuffer };
    } catch (err) {
        console.error('❌ Gemini text-to-image error:', err.response?.data || err.message);
        return { error: err.response?.data?.error?.message || err.message };
    }
}

async function editImageWithText(prompt, base64Image) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const body = {
        contents: [
            { role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: base64Image } }, { text: prompt }] }
        ],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
    };
    try {
        log('📤 Gemini image-edit body:', JSON.stringify(body, null, 2));
        const res = await axios.post(url, body, {
            responseType: 'json', headers: { 'Content-Type': 'application/json' }
        });
        console.dir(res.data, { depth: null });
        const err = res.data.errors || res.data.error;
        if (err) return { error: Array.isArray(err) ? err[0].message : err.message };
        const cand = res.data.candidates?.[0];
        if (!cand) return { error: res.data.promptFeedback?.blockReasonMessage || 'No candidate returned' };
        const text = cand.content.parts.find(p => p.text)?.text || '';
        const part = cand.content.parts.find(p => p.inlineData?.data);
        if (!part) return { error: 'No inlineData image part' };
        const imageBuffer = Buffer.from(part.inlineData.data, 'base64');
        return { text, imageBuffer };
    } catch (err) {
        console.error('❌ Gemini image-edit error:', err.response?.data || err.message);
        return { error: err.response?.data?.error?.message || err.message };
    }
}

module.exports = { generateImageWithText, editImageWithText };