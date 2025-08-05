const axios = require('axios');

async function generateImageWithText(prompt) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=' + process.env.GEMINI_API_KEY;

    const body = {
        contents: [{
            parts: [
                { text: prompt }
            ],
            role: "user"
        }],
        generationConfig: {
            responseModalities: ["TEXT", "IMAGE"]
        }
    }

    const res = await axios.post(url, body, { responseType: 'json', headers: { 'Content-Type': 'application/json' } });

    if (res.data.errors) throw new Error(res.data.errors[0].message);

    const candidates = res.data.candidates;
    if (!candidates?.length) throw new Error(res.data.promptFeedback?.blockReasonMessage || 'No candidates');

    const candidate = candidates[0];
    const text = res.data.text || candidate.content.parts.find(p => p.text)?.text || '';

    const imgPart = candidate.content.parts.find(p => p.inlineData?.data);
    if (!imgPart) throw new Error('No inlineData image found');
    const imageBuffer = Buffer.from(imgPart.inlineData.data, 'base64');

    return { text, imageBuffer };
}

module.exports = { generateImageWithText };
