/**
 * Grok AI Service
 * Integration with x.ai Grok API for text and image workflows
 */

import { sanitizeText, cleanMarkdown } from '../utils/textSanitizer';
import { detectLanguage } from './agent/utils/languageUtils';
import prompts from '../config/prompts';
import logger from '../utils/logger';

/**
 * Conversation message structure
 */
interface ConversationMessage {
  role: string;
  content: string;
}

/**
 * Text generation result
 */
interface TextGenerationResult {
  text: string;
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
  originalPrompt?: string;
  error?: string;
  metadata?: {
    service: string;
    model: string;
    type: string;
    characterCount?: number;
    created_at: string;
  };
}

/**
 * Image generation result
 */
interface ImageGenerationResult {
  success: boolean;
  imageUrl?: string;
  description?: string;
  textOnly?: boolean;
  error?: string;
  originalPrompt?: string;
  metadata?: {
    service: string;
    model: string;
    type: string;
    created_at: string;
  };
}

import { API_URLS } from '../utils/constants';

class GrokService {
  private apiKey: string | undefined;
  private baseUrl: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.GROK_API_KEY;
    this.baseUrl = API_URLS.GROK;
    this.model = 'grok-4'; // Latest and strongest model (upgraded from grok-3)

    if (!this.apiKey) {
      logger.warn('⚠️ GROK_API_KEY not found in environment variables');
    } else {
      logger.info('🤖 Grok service initialized');
    }
  }

  /**
   * Generate text response using Grok with conversation history support
   * @param prompt - User's input text
   * @param conversationHistory - Previous messages in conversation
   * @returns Response with text and usage info
   */
  async generateTextResponse(prompt: string, conversationHistory: ConversationMessage[] = []): Promise<TextGenerationResult> {
    try {
      if (!this.apiKey) {
        throw new Error('Grok API key not configured');
      }

      // Sanitize prompt
      const cleanPrompt = sanitizeText(prompt);

      // Detect user's language to ensure response matches input language
      const detectedLang = detectLanguage(cleanPrompt);

      // Build language-specific system prompt (SSOT - from config/prompts.ts)
      const systemContent = prompts.grokSystemInstruction(detectedLang);

      // Build messages array - OPTIMIZED
      const messages: ConversationMessage[] = [
        {
          role: 'system',
          content: systemContent
        }
      ];

      // Add conversation history if exists
      if (conversationHistory && conversationHistory.length > 0) {
        messages.push(...conversationHistory);
        logger.debug(`🧠 Using conversation history: ${conversationHistory.length} previous messages`);
      }

      // Add current user message
      messages.push({
        role: 'user',
        content: cleanPrompt
      });

      logger.debug(`🤖 Grok processing (${conversationHistory.length} context messages)`);

      // Make API request to Grok
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages: messages,
          max_tokens: 1000,
          temperature: 0.7,
          stream: false
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        logger.error('❌ Grok API error:', { status: response.status, error: errorData });
        throw new Error(`Grok API error: ${response.status} - ${errorData}`);
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };

      if (!data.choices || data.choices.length === 0) {
        throw new Error('No response choices from Grok API');
      }

      const aiResponse = data.choices[0]?.message?.content || '';
      const usage = data.usage || null;

      logger.info('✅ Grok response received', { usage });

      return {
        text: aiResponse.trim(),
        usage: usage,
        originalPrompt: cleanPrompt,
        metadata: {
          service: 'Grok',
          model: this.model,
          type: 'text_generation',
          characterCount: aiResponse.length,
          created_at: new Date().toISOString()
        }
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error generating Grok response:', { error: errorMessage, stack: error instanceof Error ? error.stack : undefined });

      // Emergency response
      return {
        text: 'מצטער, קרתה שגיאה בעיבוד הבקשה שלך עם Grok. נסה שוב מאוחר יותר.',
        error: errorMessage,
        usage: null
      };
    }
  }

  /**
   * Generate image using Grok with prompt
   * @param prompt - User's image generation prompt
   * @returns Image generation result
   */
  async generateImageForWhatsApp(prompt: string): Promise<ImageGenerationResult> {
    try {
      if (!this.apiKey) {
        throw new Error('Grok API key not configured');
      }

      // Sanitize prompt
      const cleanPrompt = sanitizeText(prompt);

      logger.debug(`🎨 Generating image with Grok: "${cleanPrompt}"`);

      // Call xAI image generation API
      const response = await fetch(`${this.baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: cleanPrompt,
          model: 'grok-imagine-1.0',
          response_format: 'url',
          n: 1
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        logger.error('❌ Grok image generation error:', { status: response.status, error: errorData });
        return {
          success: false,
          error: `Grok image generation failed: ${response.status} - ${errorData}`,
          originalPrompt: cleanPrompt
        };
      }

      const data = await response.json() as {
        data?: Array<{ url?: string; revised_prompt?: string }>;
        choices?: Array<{ message?: { content?: string } }>;
        text?: string;
      };

      // Handle successful response - return whatever Grok provides
      if (data.data && data.data.length > 0) {
        const imageData = data.data[0];
        if (!imageData) {
          return {
            success: false,
            error: 'No image data received from Grok API',
            originalPrompt: cleanPrompt
          };
        }
        const imageUrl = imageData.url;
        let description = imageData.revised_prompt || '';

        // Clean markdown code blocks from description (Grok sometimes returns markdown)
        if (description) {
          description = cleanMarkdown(description);
        }

        logger.info('✅ Grok image generated successfully');

        return {
          success: true,
          imageUrl: imageUrl,
          description: description,
          originalPrompt: cleanPrompt,
          metadata: {
            service: 'Grok',
            model: 'grok-2-image',
            type: 'image_generation',
            created_at: new Date().toISOString()
          }
        };
      } else {
        // If no image but response is successful, maybe it returned text only
        const textContent = data.choices?.[0]?.message?.content || data.text || '';

        if (textContent) {
          logger.info('📝 Grok returned text response instead of image');
          return {
            success: true,
            textOnly: true,
            description: textContent,
            originalPrompt: cleanPrompt,
            metadata: {
              service: 'Grok',
              model: 'grok-2-image',
              type: 'text_response',
              created_at: new Date().toISOString()
            }
          };
        } else {
          return {
            success: false,
            error: 'No image or text data received from Grok API',
            originalPrompt: cleanPrompt
          };
        }
      }

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error generating Grok image:', { error: errorMessage, stack: error instanceof Error ? error.stack : undefined });
      return {
        success: false,
        error: errorMessage || 'Unknown error occurred during image generation',
        originalPrompt: prompt
      };
    }
  }
}

/**
 * Video generation result
 */
interface VideoGenerationResult {
  success: boolean;
  videoUrl?: string;
  description?: string;
  error?: string;
  originalPrompt?: string;
  metadata?: {
    service: string;
    model: string;
    type: string;
    duration?: number;
    created_at: string;
  };
}

/**
 * Generate video from text prompt using Grok Imagine 1.0
 * @param prompt - Video description
 * @returns Video generation result with URL
 */
async function generateVideoForWhatsApp(prompt: string): Promise<VideoGenerationResult> {
  try {
    if (!process.env.GROK_API_KEY) {
      throw new Error('Grok API key not configured');
    }

    const cleanPrompt = sanitizeText(prompt);
    logger.debug(`🎬 Generating video with Grok: "${cleanPrompt.substring(0, 100)}"`);

    const response = await fetch(`${API_URLS.GROK}/video/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: cleanPrompt,
        model: 'grok-imagine-1.0',
        duration: 10, // Default 10 seconds
        aspect_ratio: '16:9' // Landscape default
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      logger.error('❌ Grok video generation error:', { status: response.status, error: errorData });
      return {
        success: false,
        error: `Grok video generation failed: ${response.status} - ${errorData}`,
        originalPrompt: cleanPrompt
      };
    }

    const data = await response.json() as {
      data?: Array<{ url?: string; revised_prompt?: string }>;
    };

    if (data.data && data.data.length > 0 && data.data[0]?.url) {
      logger.info('✅ Grok video generated successfully');
      return {
        success: true,
        videoUrl: data.data[0].url,
        description: data.data[0].revised_prompt || '',
        originalPrompt: cleanPrompt,
        metadata: {
          service: 'Grok',
          model: 'grok-imagine-1.0',
          type: 'text_to_video',
          duration: 10,
          created_at: new Date().toISOString()
        }
      };
    }

    return {
      success: false,
      error: 'No video data received from Grok API',
      originalPrompt: cleanPrompt
    };

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Error generating Grok video:', { error: errorMessage });
    return {
      success: false,
      error: errorMessage || 'Unknown error occurred during video generation',
      originalPrompt: prompt
    };
  }
}

/**
 * Generate video from image using Grok Imagine 1.0
 * @param prompt - Animation instructions
 * @param imageBuffer - Image buffer to animate
 * @returns Video generation result with URL
 */
async function generateVideoFromImageForWhatsApp(prompt: string, imageBuffer: Buffer): Promise<VideoGenerationResult> {
  try {
    if (!process.env.GROK_API_KEY) {
      throw new Error('Grok API key not configured');
    }

    const cleanPrompt = sanitizeText(prompt);
    logger.debug(`🎬 Generating video from image with Grok: "${cleanPrompt.substring(0, 100)}"`);

    // Convert buffer to base64 data URL
    const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

    const response = await fetch(`${API_URLS.GROK}/video/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: cleanPrompt,
        model: 'grok-imagine-1.0',
        image: base64Image,
        duration: 10,
        aspect_ratio: '16:9'
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      logger.error('❌ Grok image-to-video error:', { status: response.status, error: errorData });
      return {
        success: false,
        error: `Grok image-to-video failed: ${response.status} - ${errorData}`,
        originalPrompt: cleanPrompt
      };
    }

    const data = await response.json() as {
      data?: Array<{ url?: string; revised_prompt?: string }>;
    };

    if (data.data && data.data.length > 0 && data.data[0]?.url) {
      logger.info('✅ Grok image-to-video generated successfully');
      return {
        success: true,
        videoUrl: data.data[0].url,
        description: data.data[0].revised_prompt || '',
        originalPrompt: cleanPrompt,
        metadata: {
          service: 'Grok',
          model: 'grok-imagine-1.0',
          type: 'image_to_video',
          duration: 10,
          created_at: new Date().toISOString()
        }
      };
    }

    return {
      success: false,
      error: 'No video data received from Grok API',
      originalPrompt: cleanPrompt
    };

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Error generating Grok image-to-video:', { error: errorMessage });
    return {
      success: false,
      error: errorMessage || 'Unknown error occurred during video generation',
      originalPrompt: prompt
    };
  }
}

// Create and export instance
const grokService = new GrokService();

export const generateTextResponse = grokService.generateTextResponse.bind(grokService);
export const generateImageForWhatsApp = grokService.generateImageForWhatsApp.bind(grokService);
export { generateVideoForWhatsApp, generateVideoFromImageForWhatsApp };

