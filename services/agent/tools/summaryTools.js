/**
 * Summary Tools - Chat summarization
 * Clean, modular tool definitions following SOLID principles
 */

const { getServices } = require('../utils/serviceLoader');

/**
 * Tool: Chat Summary
 * 
 * IMPORTANT: Uses Green API getChatHistory to get actual WhatsApp messages
 * instead of our DB, because generateChatSummary expects Green API format
 * with textMessage/caption fields, not our DB format with content/metadata.
 */
const chat_summary = {
  declaration: {
    name: 'chat_summary',
    description: 'צור סיכום של השיחה הנוכחית. שימושי למשתמש שרוצה סיכום מהיר.',
    parameters: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: 'מספר ההודעות האחרונות לסכם (ברירת מחדל: 50)',
        }
      },
      required: []
    }
  },
  execute: async (args, context) => {
    console.log(`🔧 [Agent Tool] chat_summary called`);
    
    try {
      const { geminiService, greenApiService } = getServices();
      const messageCount = args.count || 50;
      
      // CRITICAL: Use Green API getChatHistory instead of our DB
      // because generateChatSummary expects Green API format (textMessage, caption, etc.)
      // Our DB format (content, metadata) doesn't work with generateChatSummary
      console.log(`📜 Fetching last ${messageCount} messages from Green API for chat: ${context.chatId}`);
      
      let history;
      try {
        history = await greenApiService.getChatHistory(context.chatId, messageCount);
      } catch (apiError) {
        console.error('❌ Error fetching chat history from Green API:', apiError.message);
        return {
          success: false,
          error: `שגיאה בשליפת היסטוריית השיחה מ-WhatsApp: ${apiError.message}`
        };
      }
      
      if (!history || history.length === 0) {
        return {
          success: false,
          error: 'אין מספיק הודעות לסיכום. נסה לשלוח כמה הודעות קודם.'
        };
      }
      
      console.log(`✅ Retrieved ${history.length} messages from Green API`);
      
      // Filter out system messages and keep only user/bot messages with text content
      const filteredHistory = history.filter(msg => {
        // Keep messages that have text content in various Green API formats
        const hasText = 
          msg.textMessage || 
          msg.caption || 
          (msg.typeMessage === 'textMessage') ||
          (msg.typeMessage === 'extendedTextMessage' && msg.extendedTextMessage?.text) ||
          (msg.extendedTextMessage?.text);
        
        // Also filter out system/notification messages
        const isSystemMessage = 
          msg.typeMessage === 'notificationMessage' ||
          msg.type === 'notification' ||
          (msg.textMessage && msg.textMessage.startsWith('System:'));
        
        return hasText && !isSystemMessage;
      });
      
      if (filteredHistory.length === 0) {
        return {
          success: false,
          error: 'לא נמצאו הודעות טקסט לסיכום. כל ההודעות הן מדיה בלבד.'
        };
      }
      
      console.log(`📝 Filtered to ${filteredHistory.length} text messages for summary`);
      
      const summary = await geminiService.generateChatSummary(filteredHistory);
      
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

