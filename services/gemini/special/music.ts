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
      // First, try simple regex detection for common patterns (fast and reliable)
      const videoPatterns = /\b(with|and|plus|including|include)\s+(video|clip)\b|כולל\s+(וידאו|קליפ)|עם\s+(וידאו|קליפ)|גם\s+(וידאו|קליפ)|ועם\s+(וידאו|קליפ)|\bvideo\s*clip\b|\bmusic\s*video\b/i;

      const regexMatch = videoPatterns.test(prompt);

      if (regexMatch) {
        logger.info('🎬 Video requested with music');
        // Clean the prompt by removing video/clip mentions
        const cleanPrompt = prompt
          .replace(/\s*(with|and|plus|including|include)\s+(video|clip)\s*/gi, ' ')
          .replace(/\s*כולל\s+(וידאו|קליפ)\s*/g, ' ')
          .replace(/\s*עם\s+(וידאו|קליפ)\s*/g, ' ')
          .replace(/\s*גם\s+(וידאו|קליפ)\s*/g, ' ')
          .replace(/\s*ועם\s+(וידאו|קליפ)\s*/g, ' ')
          .replace(/\s*video\s*clip\s*/gi, ' ')
          .replace(/\s*music\s*video\s*/gi, ' ')
          .trim()
          .replace(/\s+/g, ' ');

        return {
          wantsVideo: true,
          cleanPrompt: cleanPrompt || prompt
        };
      }

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

