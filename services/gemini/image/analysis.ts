import { GoogleGenerativeAI } from '@google/generative-ai';
import { sanitizeText } from '../../../utils/textSanitizer';
import { detectLanguage } from '../../agent/utils/languageUtils';
import { getLanguageInstruction } from '../../agent/utils/languageUtils';
import logger from '../../../utils/logger';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Image analysis result
 */
interface ImageAnalysisResult {
  success: boolean;
  text?: string;
  description?: string;
  error?: string;
}

/**
 * Image analysis operations
 */
class ImageAnalysis {
  /**
   * Build language instruction for image analysis
   */
  /**
   * Build language instruction for image analysis
   * Uses SSOT from config/prompts.ts
   */
  /**
   * Build language instruction for image analysis
   * Uses SSOT from config/prompts.ts
   */
  buildLanguageInstruction(detectedLang: string): string {
    // Use SSOT from config/prompts.ts
    return '\n\n' + getLanguageInstruction(detectedLang);
  }

  /**
   * Analyze image with text prompt
   */
  async analyzeImageWithText(prompt: string, base64Image: string): Promise<ImageAnalysisResult> {
    try {
      logger.info('🔍 Starting Gemini image analysis (text-only response)');

      const cleanPrompt = sanitizeText(prompt);
      const detectedLang = detectLanguage(cleanPrompt);
      const languageInstruction = this.buildLanguageInstruction(detectedLang);

      const model = genAI.getGenerativeModel({
        model: "gemini-3-flash-preview"
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
          responseModalities: ["TEXT"],
          temperature: 0.7
        } as any
      });

      const response = result.response;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseAny = response as any;
      if (!responseAny.candidates || responseAny.candidates.length === 0) {
        logger.warn('❌ Gemini image analysis: No candidates returned');
        return {
          success: false,
          error: responseAny.promptFeedback?.blockReasonMessage || 'No candidate returned'
        };
      }

      const cand = responseAny.candidates[0];
      let text = '';

      if (cand.content && cand.content.parts) {
        for (const part of cand.content.parts) {
          if (part.text) {
            text += part.text;
          }
        }
      }

      if (!text || text.trim().length === 0) {
        logger.warn('❌ Gemini image analysis: No text found in response');
        return {
          success: false,
          error: 'No text response from Gemini'
        };
      }

      logger.info('✅ Gemini image analysis completed');
      return {
        success: true,
        text: text.trim(),
        description: text.trim()
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred during image analysis';
      logger.error('❌ Gemini image analysis error:', errorMessage);
      return {
        success: false,
        error: errorMessage
      };
    }
  }
}

export default new ImageAnalysis();

