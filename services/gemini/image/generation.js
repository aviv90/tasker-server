const { GoogleGenerativeAI } = require('@google/generative-ai');
const { sanitizeText, cleanMarkdown, cleanMediaDescription } = require('../../../utils/textSanitizer');
const { getStaticFileUrl } = require('../../../utils/urlUtils');
const { getGeminiErrorMessage } = require('../utils');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { createTempFilePath } = require('../../../utils/tempFileUtils');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Image generation operations
 */
class ImageGeneration {
  /**
   * Clean prompt by removing image creation instructions
   */
  cleanPrompt(prompt) {
    let cleanPrompt = sanitizeText(prompt);

    // Remove image creation instructions from prompt (Gemini Image gets confused by them)
    cleanPrompt = cleanPrompt
      .replace(/^(ל)?(צייר|צור|הפוך|צרי|תצייר|תצור)\s+(תמונה\s+)?(של\s+)?/i, '')
      .replace(/^(to\s+)?(draw|create|make|generate|produce)\s+(an?\s+)?(image|picture|photo)\s+(of\s+)?/i, '')
      .trim();

    return cleanPrompt;
  }

  /**
   * Process Gemini image response
   */
  processImageResponse(response, prompt) {
    if (!response.candidates || response.candidates.length === 0) {
      console.log('❌ Gemini: No candidates returned');
      const errorMsg = getGeminiErrorMessage(null, response.promptFeedback);
      return { error: errorMsg };
    }

    const cand = response.candidates[0];
    let text = '';
    let imageBuffer = null;

    if (!cand.content || !cand.content.parts) {
      console.log('❌ Gemini: No content or parts found in candidate');
      console.log('   Full candidate:', JSON.stringify(cand));
      const errorMsg = getGeminiErrorMessage(cand);
      return { error: errorMsg };
    }

    // Process all parts in the response
    for (const part of cand.content.parts) {
      if (part.text) {
        text += part.text;
      } else if (part.inlineData?.data) {
        imageBuffer = Buffer.from(part.inlineData.data, 'base64');
      }
    }

    if (!imageBuffer) {
      console.log('❌ Gemini: No image data found in response');

      if (text && text.trim().length > 0) {
        console.log('📝 Gemini returned text instead of image - generation failed');
        console.log(`   Gemini response: ${text.substring(0, 200)}...`);
        return {
          error: 'Gemini לא הצליח ליצור תמונה. נסה prompt אחר או השתמש ב-OpenAI במקום.'
        };
      }

      return { error: 'No image or text data found in response' };
    }

    return { text: text || prompt, imageBuffer };
  }

  /**
   * Save image to file and return URL
   */
  saveImageForWhatsApp(imageBuffer, req, prefix = 'gemini') {
    const imageId = uuidv4();
    const fileName = `${prefix}_${imageId}.png`;
    const filePath = createTempFilePath(fileName);

    fs.writeFileSync(filePath, imageBuffer);
    const imageUrl = getStaticFileUrl(fileName, req);

    console.log(`🖼️ Image saved to: ${filePath}`);
    console.log(`🔗 Public URL: ${imageUrl}`);

    return { imageUrl, fileName, description: '' };
  }

  /**
   * Generate image from text prompt
   */
  async generateImageWithText(prompt) {
    try {
      console.log('🎨 Starting Gemini image generation');

      const cleanPrompt = this.cleanPrompt(prompt);

      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash-image-preview"
      });

      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: cleanPrompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE", "TEXT"],
          temperature: 0.7
        }
      });

      const response = result.response;
      const processResult = this.processImageResponse(response, prompt);

      if (processResult.error) {
        return processResult;
      }

      console.log('✅ Gemini image generated successfully');
      return processResult;
    } catch (err) {
      console.error('❌ Gemini image generation error:', err);
      throw err;
    }
  }

  /**
   * Generate image for WhatsApp from text prompt
   */
  async generateImageForWhatsApp(prompt, req = null) {
    try {
      console.log('🎨 Starting Gemini image generation');

      const cleanPrompt = this.cleanPrompt(prompt);

      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash-image-preview"
      });

      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: cleanPrompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE", "TEXT"],
          temperature: 0.7
        }
      });

      const response = result.response;
      const processResult = this.processImageResponse(response, prompt);

      if (processResult.error) {
        return {
          success: false,
          error: processResult.error
        };
      }

      const { imageBuffer, text } = processResult;
      const saveResult = this.saveImageForWhatsApp(imageBuffer, req, 'gemini');

      // Clean markdown, image markers, and media descriptions from text
      let cleanDescription = text.trim() || "";
      if (cleanDescription) {
        // First clean markdown
        cleanDescription = cleanMarkdown(cleanDescription);
        // Then clean image-specific markers and patterns
        cleanDescription = cleanDescription
          .replace(/\[image[:\]]/gi, '') // Remove [image: or [image]
          .replace(/image[:\]]/gi, '') // Remove image: or image]
          .replace(/\[תמונה[:\]]/gi, '') // Remove [תמונה: or [תמונה]
          .replace(/בבקשה[^.!?]*תמונה[^.!?]*\[?image/gi, '') // Remove "בבקשה...תמונה...[image"
          .replace(/יצרתי[^.!?]*תמונה[^.!?]*\[?image/gi, '') // Remove "יצרתי...תמונה...[image"
          .replace(/^[^.!?]*\[image[:\]][^.!?]*/gi, '') // Remove entire lines with [image: or [image]
          .trim();
        // Finally use cleanMediaDescription for additional cleanup
        cleanDescription = cleanMediaDescription(cleanDescription);
      }

      console.log('✅ Gemini image generated successfully');

      return {
        success: true,
        imageUrl: saveResult.imageUrl,
        description: cleanDescription,
        fileName: saveResult.fileName
      };
    } catch (err) {
      console.error('❌ Gemini image generation error:', err);
      return {
        success: false,
        error: err.message || 'Unknown error occurred during image generation'
      };
    }
  }
}

module.exports = new ImageGeneration();

