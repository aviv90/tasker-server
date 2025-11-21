const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Translation operations
 */
class TranslationService {
  /**
   * Translate text to target language
   * @param {string} text - Text to translate
   * @param {string} targetLanguage - Target language
   * @returns {Object} - Translation result
   */
  async translateText(text, targetLanguage) {
    try {
      console.log(`🌐 Translating "${text}" to ${targetLanguage}`);
      
      const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash" 
      });
      
      const translationPrompt = `Translate the following text to ${targetLanguage}. Return ONLY the translated text, nothing else.

Text to translate: "${text}"

Important: Return only the translation, no explanations, no quotes, no extra text.`;

      const result = await model.generateContent(translationPrompt);
      const response = result.response;
      
      if (!response.candidates || response.candidates.length === 0) {
        console.log('❌ Gemini translation: No candidates returned');
        return { 
          success: false, 
          error: 'Translation failed: No response from Gemini' 
        };
      }
      
      const translatedText = response.text().trim();
      
      console.log(`✅ Translation complete: "${translatedText}"`);
      
      return {
        success: true,
        translatedText: translatedText
      };
      
    } catch (err) {
      console.error('❌ Translation error:', err);
      return { 
        success: false, 
        error: err.message || 'Translation failed' 
      };
    }
  }
}

module.exports = new TranslationService();

