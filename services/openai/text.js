/**
 * OpenAI Text Generation Service
 * 
 * Handles text generation using OpenAI Chat API.
 * Extracted from openaiService.js (Phase 5.3)
 */

const OpenAI = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

/**
 * Generate text response using OpenAI Chat API with conversation history
 * @param {string} prompt - User's input text
 * @param {Array} conversationHistory - Previous messages in conversation
 * @returns {Promise<{text: string, usage: object}>}
 */
async function generateTextResponse(prompt, conversationHistory = []) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // Detect user's language to ensure response matches input language
    const { detectLanguage } = require('../../utils/agentHelpers');
    const prompts = require('../../config/prompts');
    const detectedLang = detectLanguage(prompt);
    
    // Build language-specific system prompt (SSOT - from config/prompts.js)
    const systemContent = prompts.openaiSystemInstruction(detectedLang);

    // Build messages array - OPTIMIZED
    const messages = [
      {
        role: 'system',
        content: systemContent
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
      content: prompt
    });

    console.log(`🤖 OpenAI processing (${conversationHistory.length} context messages)`);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Cost-effective and good model
      messages: messages,
      max_tokens: 1000,
      temperature: 0.7
    });

    const aiResponse = response.choices[0].message.content;
    const usage = response.usage;

    console.log('✅ OpenAI Chat response received');
    console.log('💰 Tokens used:', usage);

    return {
      text: aiResponse,
      usage: usage
    };

  } catch (error) {
    console.error('❌ Error generating OpenAI response:', error);
    
    // Emergency response
    return {
      text: 'מצטער, קרתה שגיאה בעיבוד הבקשה שלך. נסה שוב מאוחר יותר.',
      usage: null
    };
  }
}

module.exports = {
    generateTextResponse
};

