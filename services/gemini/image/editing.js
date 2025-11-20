const { GoogleGenerativeAI } = require('@google/generative-ai');
const { sanitizeText, cleanMarkdown, cleanMediaDescription } = require('../../../utils/textSanitizer');
const { getStaticFileUrl } = require('../../../utils/urlUtils');
const { getGeminiErrorMessage } = require('../utils');
const { detectLanguage } = require('../../../utils/agentHelpers');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Image editing operations
 */
class ImageEditing {
  /**
   * Build language instruction for image editing
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
   * Process Gemini image editing response
   */
  processEditResponse(response, prompt) {
    if (!response.candidates || response.candidates.length === 0) {
      console.log('❌ Gemini edit: No candidates returned');
      return { error: response.promptFeedback?.blockReasonMessage || 'No candidate returned' };
    }

    const cand = response.candidates[0];
    let text = '';
    let imageBuffer = null;

    console.log(`   Finish reason: ${cand.finishReason}`);

    if (!cand.content || !cand.content.parts) {
      console.log('❌ Gemini edit: No content or parts found in candidate');
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
      console.log('❌ Gemini edit: No image data found in response');

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
   * Process WhatsApp edit response with better error handling
   */
  processWhatsAppEditResponse(response) {
    if (!response.candidates || response.candidates.length === 0) {
      console.log('❌ Gemini edit: No candidates returned');
      console.log('   Prompt feedback:', JSON.stringify(response.promptFeedback));
      return {
        success: false,
        error: response.promptFeedback?.blockReasonMessage || 'No candidate returned'
      };
    }

    const cand = response.candidates[0];
    let text = '';
    let imageBuffer = null;

    console.log(`   Finish reason: ${cand.finishReason}`);
    if (cand.safetyRatings) {
      console.log(`   Safety ratings:`, JSON.stringify(cand.safetyRatings));
    }

    if (!cand.content || !cand.content.parts) {
      console.log('❌ Gemini edit: No content or parts found in candidate');
      console.log('   Full candidate:', JSON.stringify(cand));

      // Check for safety/policy blocks
      if (cand.finishReason === 'SAFETY' ||
        cand.finishReason === 'IMAGE_SAFETY' ||
        cand.finishReason === 'RECITATION' ||
        cand.finishReason === 'PROHIBITED_CONTENT') {

        const errorMessage = cand.finishMessage ||
          `Gemini blocked the request due to: ${cand.finishReason}. Try a different image or prompt.`;

        return {
          success: false,
          error: errorMessage
        };
      }

      if (cand.finishMessage) {
        return {
          success: false,
          error: cand.finishMessage
        };
      }

      return {
        success: false,
        error: `Gemini returned no content (reason: ${cand.finishReason || 'unknown'})`
      };
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
      console.log('❌ Gemini edit: No image data found in response');
      console.log(`   Got text response (${text.length} chars): ${text.substring(0, 200)}...`);

      if (text && text.trim().length > 0) {
        console.log('📝 Gemini returned text instead of image - edit failed');
        return {
          success: false,
          error: 'Gemini לא הצליח לערוך את התמונה. נסה prompt אחר או השתמש ב-OpenAI במקום.'
        };
      }

      return {
        success: false,
        error: 'No image or text data found in response'
      };
    }

    return { success: true, text, imageBuffer };
  }

  /**
   * Save edited image to file and return URL
   */
  saveEditedImageForWhatsApp(imageBuffer, req) {
    const fileName = `gemini_edit_${uuidv4()}.png`;
    const filePath = path.join(__dirname, '../../..', 'public', 'tmp', fileName);

    const tmpDir = path.dirname(filePath);
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    fs.writeFileSync(filePath, imageBuffer);
    const imageUrl = getStaticFileUrl(fileName, req);

    console.log(`🖼️ Edited image saved to: ${filePath}`);
    console.log(`🔗 Public URL: ${imageUrl}`);

    return { imageUrl, fileName };
  }

  /**
   * Edit image with text prompt
   */
  async editImageWithText(prompt, base64Image) {
    try {
      console.log('🖼️ Starting Gemini image editing');

      const cleanPrompt = sanitizeText(prompt);
      const detectedLang = detectLanguage(cleanPrompt);
      const languageInstruction = this.buildLanguageInstruction(detectedLang);

      const model = genAI.getGenerativeModel({
        model: "gemini-3-pro-image-preview"
      });

      const result = await model.generateContent({
        contents: [
          { role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: base64Image } }, { text: cleanPrompt + languageInstruction }] }
        ],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
      });

      const response = result.response;
      const processResult = this.processEditResponse(response, prompt);

      if (processResult.error) {
        return processResult;
      }

      console.log('✅ Gemini image edited successfully');
      return processResult;
    } catch (err) {
      console.error('❌ Gemini image edit error:', err);
      throw err;
    }
  }

  /**
   * Edit image for WhatsApp
   */
  async editImageForWhatsApp(prompt, base64Image, req) {
    try {
      console.log('🖼️ Starting Gemini image editing');

      const cleanPrompt = sanitizeText(prompt);
      const detectedLang = detectLanguage(cleanPrompt);
      const languageInstruction = this.buildLanguageInstruction(detectedLang);

      const model = genAI.getGenerativeModel({
        model: "gemini-3-pro-image-preview"
      });

      const result = await model.generateContent({
        contents: [
          { role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: base64Image } }, { text: cleanPrompt + languageInstruction }] }
        ],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
      });

      const response = result.response;
      const processResult = this.processWhatsAppEditResponse(response);

      if (!processResult.success) {
        return processResult;
      }

      const { imageBuffer, text } = processResult;
      const saveResult = this.saveEditedImageForWhatsApp(imageBuffer, req);

      // Clean markdown, image markers, and media descriptions from text
      let cleanDescription = text.trim() || "";
      if (cleanDescription) {
        // First clean markdown
        cleanDescription = cleanMarkdown(cleanDescription);
        // Then clean image-specific markers and patterns (only formatting, not text phrases)
        cleanDescription = cleanDescription
          .replace(/\[image[:\]]/gi, '') // Remove [image: or [image]
          .replace(/image[:\]]/gi, '') // Remove image: or image]
          .replace(/\[תמונה[:\]]/gi, '') // Remove [תמונה: or [תמונה]
          .replace(/^[^.!?]*\[image[:\]][^.!?]*/gi, '') // Remove entire lines with [image: or [image]
          .trim();
        // Finally use cleanMediaDescription for additional cleanup
        cleanDescription = cleanMediaDescription(cleanDescription);
      }

      console.log('✅ Gemini image edited successfully');

      return {
        success: true,
        imageUrl: saveResult.imageUrl,
        description: cleanDescription,
        fileName: saveResult.fileName
      };
    } catch (err) {
      console.error('❌ Gemini image edit error:', err);
      return {
        success: false,
        error: err.message || 'Unknown error occurred during image editing'
      };
    }
  }
}

module.exports = new ImageEditing();

