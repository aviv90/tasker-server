import { GoogleGenerativeAI } from '@google/generative-ai';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const genai = require('@google/genai');
import { sanitizeText } from '../../../utils/textSanitizer';
import { detectLanguage } from '../../../utils/agentHelpers';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

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
   */
  buildLanguageInstruction(detectedLang: string): string {
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
   * Prepare video part for Gemini API (Files API for large videos, inline for small)
   */
  async prepareVideoPart(videoBuffer: Buffer): Promise<VideoPart> {
    // For videos larger than 2MB, use Files API; otherwise use inline data
    if (videoBuffer.length > 2 * 1024 * 1024) {
      console.log('📤 Video is large, uploading to Files API first...');

      const tempFileName = `temp_analysis_video_${uuidv4()}.mp4`;
      // Use process.cwd() for safe path resolution
      const tempFilePath = path.join(process.cwd(), 'public', 'tmp', tempFileName);
      const tmpDir = path.dirname(tempFilePath);

      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }

      fs.writeFileSync(tempFilePath, videoBuffer);

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const uploadResult = await veoClient.files.upload({
          file: {
            path: tempFilePath,
            mimeType: 'video/mp4'
          }
        } as any);

        console.log('✅ Video uploaded to Files API');

        // Clean up temp file after upload
        try {
          fs.unlinkSync(tempFilePath);
          console.log('🧹 Cleaned up temporary video file');
        } catch (cleanupErr: unknown) {
          console.warn('⚠️ Could not delete temp file:', cleanupErr);
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
        console.error('❌ Failed to upload video to Files API:', uploadErr);
        console.log('🔄 Falling back to inline data...');
        const base64Video = videoBuffer.toString('base64');
        return { inlineData: { mimeType: "video/mp4", data: base64Video } };
      }
    } else {
      console.log('📦 Video is small enough, using inline data');
      const base64Video = videoBuffer.toString('base64');
      return { inlineData: { mimeType: "video/mp4", data: base64Video } };
    }
  }

  /**
   * Analyze video with text prompt
   */
  async analyzeVideoWithText(prompt: string, videoBuffer: Buffer): Promise<VideoAnalysisResult> {
    try {
      console.log('🔍 Starting Gemini video analysis (text-only response)');
      console.log(`📹 Video size: ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);

      const cleanPrompt = sanitizeText(prompt);
      const detectedLang = detectLanguage(cleanPrompt);
      const languageInstruction = this.buildLanguageInstruction(detectedLang);

      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash"
      });

      const videoPart = await this.prepareVideoPart(videoBuffer);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        console.log('❌ Gemini video analysis: No candidates returned');
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
        console.log('❌ Gemini video analysis: No text found in response');
        return {
          success: false,
          error: 'No text response from Gemini'
        };
      }

      console.log('✅ Gemini video analysis completed');
      return {
        success: true,
        text: text.trim(),
        description: text.trim()
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred during video analysis';
      console.error('❌ Gemini video analysis error:', err);
      return {
        success: false,
        error: errorMessage
      };
    }
  }
}

export default new VideoAnalysis();

