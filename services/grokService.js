/**
 * Grok AI Service
 * Integration with x.ai Grok API for text generation
 */

const { sanitizeText } = require('../utils/textSanitizer');

class GrokService {
  constructor() {
    this.apiKey = process.env.GROK_API_KEY;
    this.baseUrl = 'https://api.x.ai/v1';
    this.model = 'grok-beta'; // Default model
    
    if (!this.apiKey) {
      console.warn('⚠️ GROK_API_KEY not found in environment variables');
    } else {
      console.log('🤖 Grok service initialized');
    }
  }

  /**
   * Generate text response using Grok with conversation history
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

      // Build messages array with system prompt + conversation history + current message
      const messages = [
        {
          role: 'system',
          content: 'אתה Grok - עוזר AI ידידותי, אדיב ונעים של x.ai. תן תשובות טבעיות ונעימות באופן שיחתי. היה חם, מקשיב ומעט הומוריסטי כמו שמתאים לאופי של Grok.'
        },
        {
          role: 'user',
          content: 'היי Grok, איך אתה?'
        },
        {
          role: 'assistant',
          content: 'שלום! אני Grok ואני כאן לעזור לך. מה מעניין אותך היום? יש לי תשובות (וגם קצת הומור) 😊'
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

      console.log(`🤖 Sending to Grok: "${cleanPrompt}" (with ${conversationHistory.length} context messages)`);

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
}

// Create and export instance
const grokService = new GrokService();

module.exports = {
  generateTextResponse: grokService.generateTextResponse.bind(grokService)
};
