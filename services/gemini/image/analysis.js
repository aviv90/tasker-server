const { GoogleGenerativeAI } = require('@google/generative-ai');
const { sanitizeText } = require('../../../utils/textSanitizer');
const { detectLanguage } = require('../../../utils/agentHelpers');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Image analysis operations
 */
class ImageAnalysis {
  /**
   * Build language instruction for image analysis
   */
  buildLanguageInstruction(detectedLang) {
    switch (detectedLang) {
      case 'he':
        return '\n\nחשוב מאוד: עליך לענות בעברית בלבד. התשובה חייבת להיות בעברית, ללא מילים באנגלית אלא אם כן זה שם פרטי או מונח טכני שאין לו תרגום.';
      case 'en':
        return '\n\nIMPORTANT: You must respond in English only. The answer must be in English.';
      case 'ar':
        return '\n\nمهم جداً: يجب أن تجيب بالعربية فقط. يجب أن تكون الإجابة بالعربية.';
      case 'ru':
        return '\n\nОчень важно: вы должны отвечать только на русском языке. Ответ должен быть на русском языке.';
      default:
        return '\n\nחשוב מאוד: ענה בעברית בלבד.';
    }
  }

  /**
   * Analyze image with text prompt
   */
  async analyzeImageWithText(prompt, base64Image) {
    try {
      console.log('🔍 Starting Gemini image analysis (text-only response)');

      const cleanPrompt = sanitizeText(prompt);
      const detectedLang = detectLanguage(cleanPrompt);
      const languageInstruction = this.buildLanguageInstruction(detectedLang);

      const model = genAI.getGenerativeModel({
        model: "gemini-3-pro-preview"
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
          responseModalities: ["TEXT"]
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
}

module.exports = new ImageAnalysis();

