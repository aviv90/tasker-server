import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../../../utils/logger';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Translation result
 */
interface TranslationResult {
  success: boolean;
  translatedText?: string;
  error?: string;
}

/**
 * Translation operations
 */
class TranslationService {
  /**
   * Translate text to target language
   */
  async translateText(text: string, targetLanguage: string): Promise<TranslationResult> {
    try {
      logger.debug(`🌐 Translating "${text}" to ${targetLanguage}`);
      
      const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash" 
      });
      
      const translationPrompt = `Translate the following text to ${targetLanguage}. Return ONLY the translated text, nothing else.

Text to translate: "${text}"

Important: Return only the translation, no explanations, no quotes, no extra text.`;

      const result = await model.generateContent(translationPrompt);
      const response = result.response;
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseAny = response as any;
      if (!responseAny.candidates || responseAny.candidates.length === 0) {
        logger.warn('❌ Gemini translation: No candidates returned');
        return { 
          success: false, 
          error: 'Translation failed: No response from Gemini' 
        };
      }
      
      const translatedText = response.text().trim();
      
      logger.info(`✅ Translation complete: "${translatedText}"`);
      
      return {
        success: true,
        translatedText: translatedText
      };
      
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Translation failed';
      logger.error('❌ Translation error:', { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
      return { 
        success: false, 
        error: errorMessage
      };
    }
  }
}

export default new TranslationService();

