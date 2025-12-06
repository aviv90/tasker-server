import { GoogleGenerativeAI } from '@google/generative-ai';
import prompts from '../../../config/prompts';
import logger from '../../../utils/logger';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Music parse result
 */
interface MusicParseResult {
  wantsVideo: boolean;
  cleanPrompt: string;
}

/**
 * Music request parsing
 */
class MusicParser {
  /**
   * Parse music request to detect video requirement
   */
  async parseMusicRequest(prompt: string): Promise<MusicParseResult> {
    try {

      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash"
      });

      const analysisPrompt = prompts.musicVideoParsingPrompt(prompt);

      const result = await model.generateContent(analysisPrompt);
      const response = result.response;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseAny = response as any;
      if (!responseAny.candidates || responseAny.candidates.length === 0) {
        logger.warn('❌ Gemini music parsing: No candidates returned');
        return { wantsVideo: false, cleanPrompt: prompt };
      }

      let rawText = response.text().trim();

      // Remove markdown code fences if present
      rawText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '');

      const parsed = JSON.parse(rawText) as MusicParseResult;

      if (parsed.wantsVideo) {
        logger.info('🎬 Video requested with music (LLM detected)');
      }
      return parsed;

    } catch (err: unknown) {
      logger.error('❌ Error parsing music request:', err as Error);
      // Fallback: no video
      return { wantsVideo: false, cleanPrompt: prompt };
    }
  }
}

export default new MusicParser();

