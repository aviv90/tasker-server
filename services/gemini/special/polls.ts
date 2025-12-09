import { GoogleGenerativeAI } from '@google/generative-ai';
import { sanitizeText } from '../../../utils/textSanitizer';
import crypto from 'crypto';
import logger from '../../../utils/logger';
import prompts from '../../../config/prompts';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Poll result
 */
interface PollResult {
  success: boolean;
  question?: string;
  options?: string[];
  numOptions?: number;
  error?: string;
}

/**
 * Poll generation operations
 */
class PollGenerator {
  /**
   * Build poll prompt with or without rhyming
   * Uses SSOT from config/prompts.ts
   */
  buildPollPrompt(cleanTopic: string, numOptions: number, withRhyme: boolean, language = 'he'): string {
    return prompts.pollGenerationPrompt(cleanTopic, numOptions, withRhyme, language);
  }

  /**
   * Parse and validate poll response
   */
  parsePollResponse(responseText: string, numOptions: number): { question: string; options: string[] } {
    let jsonText = responseText.trim();

    // If wrapped in code fences, strip them
    const fenceMatch = jsonText.match(/```[a-zA-Z]*\n([\s\S]*?)\n```/);
    if (fenceMatch && fenceMatch[1]) {
      jsonText = fenceMatch[1].trim();
    }

    let parsed: { question: string; options: string[] };
    try {
      parsed = JSON.parse(jsonText);
    } catch (_parseError) {
      logger.error('❌ Failed to parse Gemini poll response:', { jsonText });
      throw new Error('Failed to parse poll data from Gemini');
    }

    // Validate the response
    if (!parsed.question || !parsed.options || !Array.isArray(parsed.options)) {
      throw new Error('Invalid poll data structure from Gemini');
    }

    // Validate number of options (must be between 2-4 and match what we requested)
    if (parsed.options.length < 2 || parsed.options.length > 4) {
      throw new Error(`Invalid number of options: ${parsed.options.length} (expected ${numOptions})`);
    }

    // Ensure limits
    if (parsed.question.length > 255) {
      parsed.question = parsed.question.substring(0, 252) + '...';
    }

    // Truncate each option if needed
    parsed.options = parsed.options.map(opt => {
      if (opt.length > 100) {
        return opt.substring(0, 97) + '...';
      }
      return opt;
    });

    return parsed;
  }

  /**
   * Generate creative poll with optional rhyming
   */
  async generateCreativePoll(topic: string, withRhyme = true, language = 'he'): Promise<PollResult> {
    try {
      logger.info(`📊 Generating creative poll about: ${topic} ${withRhyme ? '(with rhyme)' : '(without rhyme)'} (Language: ${language})`);

      const cleanTopic = sanitizeText(topic);

      // Randomly choose number of options (2-4)
      const numOptions = crypto.randomInt(2, 5); // 2, 3, or 4
      logger.debug(`🎲 Randomly selected ${numOptions} poll options`);

      const pollPrompt = this.buildPollPrompt(cleanTopic, numOptions, withRhyme, language);

      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash"
      });

      const result = await model.generateContent(pollPrompt);

      if (!result.response) {
        throw new Error('No response from Gemini');
      }

      const responseText = result.response.text();
      const parsed = this.parsePollResponse(responseText, numOptions);

      logger.info(`✅ Poll generated successfully with ${parsed.options.length} ${withRhyme ? 'rhyming' : 'non-rhyming'} options:`, {
        question: parsed.question,
        options: parsed.options
      });

      return {
        success: true,
        question: parsed.question,
        options: parsed.options,
        numOptions: parsed.options.length
      };

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate poll';
      logger.error('❌ Poll generation error:', { error: errorMessage, stack: err instanceof Error ? err.stack : undefined });
      return {
        success: false,
        error: errorMessage
      };
    }
  }
}

export default new PollGenerator();

