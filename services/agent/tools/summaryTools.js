/**
 * Summary Tools - Chat summarization
 * Clean, modular tool definitions following SOLID principles
 */

const conversationManager = require('../../conversationManager');
const { getServices } = require('../utils/serviceLoader');

/**
 * Tool: Chat Summary
 */
const chat_summary = {
  declaration: {
    name: 'chat_summary',
    description: 'צור סיכום של השיחה הנוכחית. שימושי למשתמש שרוצה סיכום מהיר.',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  execute: async (args, context) => {
    console.log(`🔧 [Agent Tool] chat_summary called`);
    
    try {
      const { geminiService } = getServices();
      
      const history = await conversationManager.getConversationHistory(context.chatId);
      
      if (!history || history.length === 0) {
        return {
          success: false,
          error: 'אין מספיק הודעות לסיכום'
        };
      }
      
      const summary = await geminiService.generateChatSummary(history);
      
      if (summary.error) {
        return {
          success: false,
          error: `יצירת סיכום נכשלה: ${summary.error}`
        };
      }
      
      return {
        success: true,
        data: summary.text || summary,
        summary: summary.text || summary
      };
    } catch (error) {
      console.error('❌ Error in chat_summary:', error);
      return {
        success: false,
        error: `שגיאה: ${error.message}`
      };
    }
  }
};

module.exports = {
  chat_summary
};

