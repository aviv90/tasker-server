/**
 * Grok AI Service
 * Integration with x.ai Grok API for text generation
 */

const { sanitizeText } = require('../utils/textSanitizer');

class GrokService {
  constructor() {
    this.apiKey = process.env.GROK_API_KEY;
    this.baseUrl = 'https://api.x.ai/v1';
    this.model = 'grok-4'; // Latest and strongest model (upgraded from grok-3)
    
    if (!this.apiKey) {
      console.warn('⚠️ GROK_API_KEY not found in environment variables');
    } else {
      console.log('🤖 Grok service initialized');
    }
  }

  /**
   * Generate text response using Grok with conversation history support
   * @param {string} prompt - User's input text
   * @param {Array} conversationHistory - Previous messages in conversation
   * @returns {Promise<{text: string, usage: object}>}
   */
  async generateTextResponse(prompt, conversationHistory = []) {
    try {
      if (!this.apiKey) {
        throw new Error('Grok API key not configured');
      }

      // Sanitize prompt
      const cleanPrompt = sanitizeText(prompt);

      // Build messages array - OPTIMIZED
      const messages = [
        {
          role: 'system',
          content: 'אתה Grok - עוזר AI ידידותי. תן תשובות ישירות וטבעיות.'
        }
      ];

      // Add conversation history if exists
      if (conversationHistory && conversationHistory.length > 0) {
        messages.push(...conversationHistory);
        console.log(`🧠 Using conversation history: ${conversationHistory.length} previous messages`);
      }

      // Add current user message
      messages.push({
        role: 'user',
        content: cleanPrompt
      });

      console.log(`🤖 Grok processing (${conversationHistory.length} context messages)`);

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
        console.error('❌ Grok API error:', response.status, errorData);
        throw new Error(`Grok API error: ${response.status} - ${errorData}`);
      }

      const data = await response.json();

      if (!data.choices || data.choices.length === 0) {
        throw new Error('No response choices from Grok API');
      }

      const aiResponse = data.choices[0].message.content;
      const usage = data.usage;

      console.log('✅ Grok response received');
      console.log('💰 Tokens used:', usage);

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

    } catch (error) {
      console.error('❌ Error generating Grok response:', error);
      
      // Emergency response
      return {
        text: 'מצטער, קרתה שגיאה בעיבוד הבקשה שלך עם Grok. נסה שוב מאוחר יותר.',
        error: error.message || 'Text generation failed',
        usage: null
      };
    }
  }

  /**
   * Generate image using Grok with prompt
   * @param {string} prompt - User's image generation prompt
   * @returns {Promise<{imageUrl?: string, description?: string, success: boolean}>}
   */
  async generateImageForWhatsApp(prompt) {
    try {
      if (!this.apiKey) {
        throw new Error('Grok API key not configured');
      }

      // Sanitize prompt
      const cleanPrompt = sanitizeText(prompt);

      console.log(`🎨 Generating image with Grok: "${cleanPrompt}"`);

      // Call xAI image generation API
      const response = await fetch(`${this.baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: cleanPrompt,
          model: "grok-2-image",
          response_format: "url",
          n: 1
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('❌ Grok image generation error:', response.status, errorData);
        return {
          success: false,
          error: `Grok image generation failed: ${response.status} - ${errorData}`,
          originalPrompt: cleanPrompt
        };
      }

      const data = await response.json();

      // Handle successful response - return whatever Grok provides
      if (data.data && data.data.length > 0) {
        const imageData = data.data[0];
        const imageUrl = imageData.url;
        const description = imageData.revised_prompt || '';

        console.log('✅ Grok image generated successfully');

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
          console.log('📝 Grok returned text response instead of image');
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

    } catch (error) {
      console.error('❌ Error generating Grok image:', error);
      return {
        success: false,
        error: error.message || 'Unknown error occurred during image generation',
        originalPrompt: prompt
      };
    }
  }
}

// Create and export instance
const grokService = new GrokService();

module.exports = {
  generateTextResponse: grokService.generateTextResponse.bind(grokService),
  generateImageForWhatsApp: grokService.generateImageForWhatsApp.bind(grokService)
};
