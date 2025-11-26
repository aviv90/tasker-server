import { GoogleGenerativeAI } from '@google/generative-ai';
import prompts from '../../../config/prompts';
import logger from '../../../utils/logger';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * TTS parse result
 */
interface TTSParseResult {
  needsTranslation: boolean;
  text: string;
  targetLanguage?: string;
  languageCode?: string;
}

/**
 * Text-to-speech request parsing
 */
class TTSParser {
  /**
   * Parse text-to-speech request to detect if translation is needed
   */
  async parseTextToSpeechRequest(prompt: string): Promise<TTSParseResult> {
    try {
      logger.info('🔍 Parsing TTS request for translation needs');

      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash"
      });

      const analysisPrompt = prompts.ttsParsingPrompt(prompt);

      const result = await model.generateContent(analysisPrompt);
      const response = result.response;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseAny = response as any;
      if (!responseAny.candidates || responseAny.candidates.length === 0) {
        logger.warn('❌ Gemini TTS parsing: No candidates returned');
        return { needsTranslation: false, text: prompt };
      }

      let rawText = response.text().trim();

      // Remove markdown code fences if present
      rawText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '');

      const parsed = JSON.parse(rawText) as TTSParseResult;

      logger.info('✅ TTS request parsed:', parsed);
      return parsed;

    } catch (err: unknown) {
      logger.error('❌ Error parsing TTS request:', err as Error);
      // Fallback: no translation
      return { needsTranslation: false, text: prompt };
    }
  }
}

export default new TTSParser();

