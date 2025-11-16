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
      
      // Filter out system messages but keep ALL user/bot messages (text + media)
      const filteredHistory = history.filter(msg => {
        // Filter out system/notification messages
        const isSystemMessage = 
          msg.typeMessage === 'notificationMessage' ||
          msg.type === 'notification' ||
          (msg.textMessage && msg.textMessage.startsWith('System:'));
        
        // Keep all non-system messages (text, media, or both)
        return !isSystemMessage;
      });
      
      if (filteredHistory.length === 0) {
        return {
          success: false,
          error: 'אין מספיק הודעות לסיכום. נסה לשלוח כמה הודעות קודם.'
        };
      }
      
      // Count message types for logging
      const textMessages = filteredHistory.filter(msg => 
        msg.textMessage || msg.caption || 
        msg.typeMessage === 'textMessage' || 
        (msg.typeMessage === 'extendedTextMessage' && msg.extendedTextMessage?.text)
      ).length;
      const mediaMessages = filteredHistory.length - textMessages;
      
      console.log(`📝 Including ${filteredHistory.length} messages for summary (${textMessages} text, ${mediaMessages} media)`);
      
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

