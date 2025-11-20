const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Text-to-speech request parsing
 */
class TTSParser {
  /**
   * Parse text-to-speech request to detect if translation is needed
   */
  async parseTextToSpeechRequest(prompt) {
    try {
      console.log('🔍 Parsing TTS request for translation needs');

      const model = genAI.getGenerativeModel({
        model: "gemini-3-pro-preview"
      });

      const analysisPrompt = `Analyze this text-to-speech request and determine if the user wants the output in a specific language.

User request: "${prompt}"

Return ONLY a JSON object (no markdown, no extra text) with this exact structure:
{
  "needsTranslation": true/false,
  "text": "the text to speak",
  "targetLanguage": "language name in English (e.g., Japanese, French, Spanish)",
  "languageCode": "ISO 639-1 code (e.g., ja, fr, es, he, en, ar)"
}

Rules:
1. If user explicitly requests a language (e.g., "say X in Japanese", "אמור X ביפנית", "read X in French"), set needsTranslation=true
2. Extract the actual text to speak (without the language instruction)
3. Map the target language to its ISO code
4. If no specific language is requested, set needsTranslation=false, use the original text, and omit targetLanguage/languageCode

Examples:
Input: "אמור היי מה נשמע ביפנית"
Output: {"needsTranslation":true,"text":"היי מה נשמע","targetLanguage":"Japanese","languageCode":"ja"}

Input: "say hello world in French"
Output: {"needsTranslation":true,"text":"hello world","targetLanguage":"French","languageCode":"fr"}

Input: "קרא את הטקסט הזה בערבית: שלום עולם"
Output: {"needsTranslation":true,"text":"שלום עולם","targetLanguage":"Arabic","languageCode":"ar"}

Input: "אמור שלום"
Output: {"needsTranslation":false,"text":"אמור שלום"}

Input: "read this text"
Output: {"needsTranslation":false,"text":"read this text"}`;

      const result = await model.generateContent(analysisPrompt);
      const response = result.response;

      if (!response.candidates || response.candidates.length === 0) {
        console.log('❌ Gemini TTS parsing: No candidates returned');
        return { needsTranslation: false, text: prompt };
      }

      let rawText = response.text().trim();

      // Remove markdown code fences if present
      rawText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '');

      const parsed = JSON.parse(rawText);

      console.log('✅ TTS request parsed:', parsed);
      return parsed;

    } catch (err) {
      console.error('❌ Error parsing TTS request:', err);
      // Fallback: no translation
      return { needsTranslation: false, text: prompt };
    }
  }
}

module.exports = new TTSParser();

