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
import { TIME } from '../../../utils/constants';
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
   * Prepare video part for Gemini API
   * Uses Files API for reliable video handling.
   */
  async prepareVideoPart(videoBuffer: Buffer): Promise<VideoPart> {
    logger.info('📤 Uploading video to Files API...');
    logger.info(`📹 Video buffer size: ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);

    const tempFileName = `temp_analysis_video_${uuidv4()}.mp4`;
    const tempFilePath = createTempFilePath(tempFileName);
    const tmpDir = path.dirname(tempFilePath);

    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    fs.writeFileSync(tempFilePath, videoBuffer);
    logger.info(`📁 Temp file written: ${tempFilePath}`);

    try {
      // Upload file to Files API
      const uploadResult = await veoClient.files.upload({
        file: tempFilePath,
        config: {
          mimeType: 'video/mp4'
        }
      });

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
      const fileName = uploadResultAny.name;
      const fileUri = uploadResultAny.uri;

      logger.info(`📎 File name: ${fileName}, URI: ${fileUri}`);

      // Wait for file to be in ACTIVE state (required for generateContent)
      logger.info('⏳ Waiting for file to be ready (ACTIVE state)...');
      let fileState = uploadResultAny.state;
      let attempts = 0;
      const maxAttempts = 30; // 30 seconds max wait

      while (fileState !== 'ACTIVE' && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, TIME.SECOND));
        attempts++;

        try {
          const fileInfo = await veoClient.files.get({ name: fileName });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          fileState = (fileInfo as any).state;
          logger.debug(`📊 File state check ${attempts}: ${fileState}`);
        } catch (getErr) {
          logger.warn(`⚠️ Could not check file state (attempt ${attempts}):`, getErr);
        }
      }

      if (fileState !== 'ACTIVE') {
        logger.error(`❌ File did not become ACTIVE after ${maxAttempts} seconds. State: ${fileState}`);
        throw new Error(`File upload timed out - file state: ${fileState}`);
      }

      logger.info(`✅ File is now ACTIVE and ready to use`);

      return {
        fileData: {
          fileUri: fileUri,
          mimeType: uploadResultAny.mimeType || 'video/mp4'
        }
      };
    } catch (uploadErr: unknown) {
      logger.error('❌ Failed to upload video to Files API:', uploadErr as Error);

      // Clean up temp file on error
      try {
        fs.unlinkSync(tempFilePath);
      } catch (_) { /* ignore */ }

      // Fallback to inline data for smaller files (under 15MB)
      if (videoBuffer.length < 15 * 1024 * 1024) {
        logger.info('🔄 Falling back to inline data...');
        const base64Video = videoBuffer.toString('base64');
        return { inlineData: { mimeType: "video/mp4", data: base64Video } };
      }

      throw new Error(`Failed to upload video: ${uploadErr instanceof Error ? uploadErr.message : 'Unknown error'}`);
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
        model: "gemini-3-pro-preview"
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
          temperature: 0.7
        }
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

