/**
 * Grok AI Service
 * Integration with x.ai Grok API for text and image workflows
 */

import { sanitizeText, cleanMarkdown } from '../utils/textSanitizer';
import { detectLanguage } from './agent/utils/languageUtils';
import prompts from '../config/prompts';
import logger from '../utils/logger';
import { API_URLS } from '../utils/constants';

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



class GrokService {
  private apiKey: string | undefined;
  private baseUrl: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.GROK_API_KEY;
    this.baseUrl = API_URLS.GROK;
    this.model = 'grok-4-1-fast-reasoning'; // Fast Reasoning Model (Fast & Economical)

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
          model: 'grok-imagine-image',
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
 * Poll for video generation result
 * @param requestId - The request ID from initial video generation request
 * @param maxAttempts - Maximum number of polling attempts
 * @param intervalMs - Interval between polling attempts in milliseconds
 * @returns Video URL or null if failed
 */
async function pollForVideoResult(requestId: string, maxAttempts = 60, intervalMs = 5000): Promise<{ url?: string; error?: string }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Correct endpoint: /v1/videos/{request_id}
      const response = await fetch(`${API_URLS.GROK}/videos/${requestId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.GROK_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.text();
        logger.warn(`Grok video poll attempt ${attempt + 1} failed:`, { status: response.status, error: errorData });
        await new Promise(resolve => setTimeout(resolve, intervalMs));
        continue;
      }

      const data = await response.json() as Record<string, unknown>;

      // Log the FULL raw response for debugging - this will show us exactly what xAI returns
      logger.info(`🔍 Grok video poll FULL response (attempt ${attempt + 1}/${maxAttempts}):`, {
        rawResponse: JSON.stringify(data).substring(0, 500) // Limit to prevent huge logs
      });

      // Check for completion states (various possible field names)
      const state = (data.state || data.status || '') as string;

      // Check for video URL in multiple possible locations
      const videoObj = data.video as Record<string, unknown> | undefined;
      const outputObj = data.output as Record<string, unknown> | undefined;
      const resultObj = data.result as Record<string, unknown> | undefined;

      const videoUrl = (
        data.url ||
        data.video_url ||
        videoObj?.url ||
        outputObj?.url ||
        resultObj?.url ||
        resultObj?.video_url ||
        (resultObj?.video as Record<string, unknown>)?.url
      ) as string | undefined;

      // Success states
      if (state.toLowerCase() === 'completed' || state.toLowerCase() === 'succeeded' || state.toLowerCase() === 'success') {
        if (videoUrl) {
          logger.info(`✅ Grok video generation completed! URL: ${videoUrl.substring(0, 80)}...`);
          return { url: videoUrl };
        }
        // URL might be in data directly without state
        logger.warn('Grok returned success state but no URL found in response', { data: JSON.stringify(data) });
      }

      // If URL exists directly (some APIs return URL when ready without explicit state)
      if (videoUrl && !state) {
        logger.info(`✅ Grok video URL found directly: ${videoUrl.substring(0, 80)}...`);
        return { url: videoUrl };
      }

      // Also check if URL exists with any state (in case API returns URL with in_progress)
      if (videoUrl && state) {
        logger.info(`✅ Grok video URL found (state: ${state}): ${videoUrl.substring(0, 80)}...`);
        return { url: videoUrl };
      }

      // Failure states
      if (state.toLowerCase() === 'failed' || state.toLowerCase() === 'error' || data.error) {
        const errorMsg = (data.error || data.message || 'Video generation failed') as string;
        logger.error('❌ Grok video generation failed:', { state, error: errorMsg });
        return { error: errorMsg };
      }

      // In-progress states - continue polling
      if (state.toLowerCase() === 'pending' || state.toLowerCase() === 'in_progress' || state.toLowerCase() === 'processing' || state.toLowerCase() === 'queued' || !state) {
        logger.info(`⏳ Grok video generation in progress (attempt ${attempt + 1}/${maxAttempts}, state: ${state || 'unknown'})`);
      } else if (state) {
        logger.warn(`⚠️ Unknown Grok video state: "${state}" (attempt ${attempt + 1})`);
      }

      await new Promise(resolve => setTimeout(resolve, intervalMs));

    } catch (error) {
      logger.warn(`Polling error on attempt ${attempt + 1}:`, { error });
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  return { error: 'Video generation timed out after maximum polling attempts' };
}

/**
 * Generate video from text prompt using Grok
 * Uses async polling mechanism as per xAI API specification
 * @param prompt - Video description
 * @returns Video generation result with URL
 */
async function generateVideoForWhatsApp(prompt: string): Promise<VideoGenerationResult> {
  try {
    if (!process.env.GROK_API_KEY) {
      throw new Error('Grok API key not configured');
    }

    const cleanPrompt = sanitizeText(prompt);
    logger.info(`🎬 Generating video with Grok: "${cleanPrompt.substring(0, 100)}..."`);

    // Step 1: Start video generation request
    // Correct endpoint: /v1/videos/generations
    const response = await fetch(`${API_URLS.GROK}/videos/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: cleanPrompt,
        model: 'grok-imagine-video'
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      logger.error('❌ Grok video generation start error:', { status: response.status, error: errorData });
      return {
        success: false,
        error: `Grok video generation failed: ${response.status} - ${errorData}`,
        originalPrompt: cleanPrompt
      };
    }

    const data = await response.json() as { request_id?: string };

    if (!data.request_id) {
      return {
        success: false,
        error: 'No request_id received from Grok API',
        originalPrompt: cleanPrompt
      };
    }

    logger.info(`📦 Grok video request started, polling for result... (ID: ${data.request_id})`);

    // Step 2: Poll for result
    const result = await pollForVideoResult(data.request_id);

    if (result.error) {
      return {
        success: false,
        error: result.error,
        originalPrompt: cleanPrompt
      };
    }

    if (result.url) {
      logger.info('✅ Grok video generated successfully');
      return {
        success: true,
        videoUrl: result.url,
        originalPrompt: cleanPrompt,
        metadata: {
          service: 'Grok',
          model: 'grok-imagine-video',
          type: 'text_to_video',
          created_at: new Date().toISOString()
        }
      };
    }

    return {
      success: false,
      error: 'No video URL received from Grok API',
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
 * Generate video from image using Grok
 * Uses async polling mechanism as per xAI API specification
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
    logger.info(`🎬 Generating video from image with Grok: "${cleanPrompt.substring(0, 100)}..."`);

    // Convert buffer to base64 data URL
    const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

    // Step 1: Start video generation request with image (same generations endpoint)
    const response = await fetch(`${API_URLS.GROK}/videos/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: cleanPrompt,
        model: 'grok-imagine-video',
        image_url: base64Image
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      logger.error('❌ Grok image-to-video start error:', { status: response.status, error: errorData });
      return {
        success: false,
        error: `Grok image-to-video failed: ${response.status} - ${errorData}`,
        originalPrompt: cleanPrompt
      };
    }

    const data = await response.json() as { request_id?: string };

    if (!data.request_id) {
      return {
        success: false,
        error: 'No request_id received from Grok API',
        originalPrompt: cleanPrompt
      };
    }

    logger.info(`📦 Grok image-to-video request started, polling for result... (ID: ${data.request_id})`);

    // Step 2: Poll for result
    const result = await pollForVideoResult(data.request_id);

    if (result.error) {
      return {
        success: false,
        error: result.error,
        originalPrompt: cleanPrompt
      };
    }

    if (result.url) {
      logger.info('✅ Grok image-to-video generated successfully');
      return {
        success: true,
        videoUrl: result.url,
        originalPrompt: cleanPrompt,
        metadata: {
          service: 'Grok',
          model: 'grok-imagine-video',
          type: 'image_to_video',
          created_at: new Date().toISOString()
        }
      };
    }

    return {
      success: false,
      error: 'No video URL received from Grok API',
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

