const { GoogleGenerativeAI } = require('@google/generative-ai');
const genai = require('@google/genai');
const { sanitizeText } = require('../../../utils/textSanitizer');
const { detectLanguage } = require('../../../utils/agentHelpers');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const veoClient = new genai.GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

/**
 * Video analysis operations
 */
class VideoAnalysis {
  /**
   * Build language instruction for video analysis
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
   * Prepare video part for Gemini API (Files API for large videos, inline for small)
   */
  async prepareVideoPart(videoBuffer) {
    // For videos larger than 2MB, use Files API; otherwise use inline data
    if (videoBuffer.length > 2 * 1024 * 1024) {
      console.log('📤 Video is large, uploading to Files API first...');

      const tempFileName = `temp_analysis_video_${uuidv4()}.mp4`;
      const tempFilePath = path.join(__dirname, '../../..', 'public', 'tmp', tempFileName);
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
        });

        console.log('✅ Video uploaded to Files API');

        // Clean up temp file after upload
        try {
          fs.unlinkSync(tempFilePath);
          console.log('🧹 Cleaned up temporary video file');
        } catch (cleanupErr) {
          console.warn('⚠️ Could not delete temp file:', cleanupErr.message);
        }

        return {
          fileData: {
            fileUri: uploadResult.file.uri,
            mimeType: uploadResult.file.mimeType
          }
        };
      } catch (uploadErr) {
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
  async analyzeVideoWithText(prompt, videoBuffer) {
    try {
      console.log('🔍 Starting Gemini video analysis (text-only response)');
      console.log(`📹 Video size: ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);

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
              videoPart,
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
        console.log('❌ Gemini video analysis: No candidates returned');
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
    } catch (err) {
      console.error('❌ Gemini video analysis error:', err);
      return {
        success: false,
        error: err.message || 'Unknown error occurred during video analysis'
      };
    }
  }
}

module.exports = new VideoAnalysis();

