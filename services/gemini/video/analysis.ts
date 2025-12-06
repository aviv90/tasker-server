import { GoogleGenerativeAI } from '@google/generative-ai';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const genai = require('@google/genai');
import { sanitizeText } from '../../../utils/textSanitizer';
import { detectLanguage } from '../../agent/utils/languageUtils';
import { getLanguageInstruction } from '../../agent/utils/languageUtils';
import logger from '../../../utils/logger';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createTempFilePath } from '../../../utils/tempFileUtils';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const veoClient = new genai.GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

/**
 * Video analysis result
 */
interface VideoAnalysisResult {
  success: boolean;
  text?: string;
  description?: string;
  error?: string;
}

/**
 * Video part
 */
interface VideoPart {
  fileData?: {
    fileUri: string;
    mimeType: string;
  };
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

/**
 * Video analysis operations
 */
class VideoAnalysis {
  /**
   * Build language instruction for video analysis
   * Uses SSOT from config/prompts.ts
   */
  buildLanguageInstruction(detectedLang: string): string {
    // Use SSOT from config/prompts.ts
    return '\n\n' + getLanguageInstruction(detectedLang);
  }

  /**
   * Prepare video part for Gemini API (Files API for large videos, inline for small)
   */
  async prepareVideoPart(videoBuffer: Buffer): Promise<VideoPart> {
    // For videos larger than 2MB, use Files API; otherwise use inline data
    if (videoBuffer.length > 2 * 1024 * 1024) {
      logger.info('📤 Video is large, uploading to Files API first...');

      const tempFileName = `temp_analysis_video_${uuidv4()}.mp4`;
      // Use process.cwd() for safe path resolution
      // Use createTempFilePath for consistent path resolution (uses config.paths.tmp)
      const tempFilePath = createTempFilePath(tempFileName);
      const tmpDir = path.dirname(tempFilePath);

      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }

      fs.writeFileSync(tempFilePath, videoBuffer);

      try {

        const uploadResult = await veoClient.files.upload({
          file: {
            path: tempFilePath,
            mimeType: 'video/mp4'
          }
        } as any);

        logger.info('✅ Video uploaded to Files API');

        // Clean up temp file after upload
        try {
          fs.unlinkSync(tempFilePath);
          logger.info('🧹 Cleaned up temporary video file');
        } catch (cleanupErr: unknown) {
          logger.warn('⚠️ Could not delete temp file:', cleanupErr as Error);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const uploadResultAny = uploadResult as any;
        return {
          fileData: {
            fileUri: uploadResultAny.file.uri,
            mimeType: uploadResultAny.file.mimeType
          }
        };
      } catch (uploadErr: unknown) {
        logger.error('❌ Failed to upload video to Files API:', uploadErr as Error);
        logger.info('🔄 Falling back to inline data...');
        const base64Video = videoBuffer.toString('base64');
        return { inlineData: { mimeType: "video/mp4", data: base64Video } };
      }
    } else {
      logger.info('📦 Video is small enough, using inline data');
      const base64Video = videoBuffer.toString('base64');
      return { inlineData: { mimeType: "video/mp4", data: base64Video } };
    }
  }

  /**
   * Analyze video with text prompt
   */
  async analyzeVideoWithText(prompt: string, videoBuffer: Buffer): Promise<VideoAnalysisResult> {
    try {
      logger.info('🔍 Starting Gemini video analysis (text-only response)');
      logger.info(`📹 Video size: ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);

      const cleanPrompt = sanitizeText(prompt);
      const detectedLang = detectLanguage(cleanPrompt);
      const languageInstruction = this.buildLanguageInstruction(detectedLang);

      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash"
      });

      const videoPart = await this.prepareVideoPart(videoBuffer);


      const result = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              videoPart as any,
              { text: cleanPrompt + languageInstruction }
            ]
          }
        ],
        generationConfig: {
          responseModalities: ["TEXT"],
          temperature: 0.7
        } as any
      } as any);

      const response = result.response;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseAny = response as any;
      if (!responseAny.candidates || responseAny.candidates.length === 0) {
        logger.warn('❌ Gemini video analysis: No candidates returned');
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
        logger.warn('❌ Gemini video analysis: No text found in response');
        return {
          success: false,
          error: 'No text response from Gemini'
        };
      }

      logger.info('✅ Gemini video analysis completed');
      return {
        success: true,
        text: text.trim(),
        description: text.trim()
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred during video analysis';
      logger.error('❌ Gemini video analysis error:', err as Error);
      return {
        success: false,
        error: errorMessage
      };
    }
  }
}

export default new VideoAnalysis();

