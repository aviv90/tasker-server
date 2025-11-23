/**
 * Context Tools
 * Tools for accessing chat history, memory, and preferences
 */

const conversationManager = require('../../conversationManager');
const { getServices } = require('../utils/serviceLoader');
// messageTypeCache is already imported above

/**
 * Get chat history tool
 */
const get_chat_history = {
  declaration: {
    name: 'get_chat_history',
    description: `קבל את היסטוריית ההודעות מהשיחה. 

**מתי להשתמש בכלי הזה (חובה!):**
• המשתמש מבקש מידע על השיחה/קבוצה (דוגמאות: "מתי כל חבר קבוצה יכול להיפגש", "מה דיברנו על X", "מי אמר Y", "מתי נקבעה הפגישה", "איזה מידע יש על X בשיחה")
• המשתמש מתייחס להודעות קודמות או מבקש מידע שהיה בשיחה
• אתה צריך קונטקסט נוסף מהשיחה כדי לענות על שאלה
• המשתמש שואל על מידע שקשור לקבוצה/שיחה ואין לך את המידע - חובה להשתמש בכלי הזה!
• המשתמש מבקש לסכם/לנתח/לחפש משהו בהיסטוריית השיחה

**חשוב מאוד:**
- אם המשתמש מבקש מידע על השיחה/קבוצה ואין לך את המידע - אל תגיד "אין לי גישה" או "אני לא יכול לדעת"! יש לך את הכלי הזה!
- תמיד קרא ל-get_chat_history לפני שתגיד שאין לך מידע על השיחה/קבוצה
- הכלי מחזיר את כל ההודעות הקודמות מהשיחה, כולל טקסט, תמונות, וידאו, אודיו`,
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'מספר ההודעות האחרונות לשלוף (ברירת מחדל: 20)',
        }
      },
      required: []
    }
  },
  execute: async (args, context) => {
    const limit = args.limit || 20;
    console.log(`🔧 [Agent Tool] get_chat_history called with limit: ${limit}`);
    
    try {
      // CRITICAL: Use Green API getChatHistory instead of our DB
      // Our DB only stores commands (messages starting with #), not regular messages
      // Green API has the complete conversation history including all messages
      const { greenApiService } = getServices();
      
      console.log(`📜 Fetching last ${limit} messages from Green API for chat: ${context.chatId}`);
      
      let greenApiHistory;
      try {
        greenApiHistory = await greenApiService.getChatHistory(context.chatId, limit);
      } catch (apiError) {
        console.error('❌ Error fetching chat history from Green API:', apiError.message);
        // Fallback to DB if Green API fails
        console.log('🔄 Falling back to DB conversation history...');
        const dbHistory = await conversationManager.getConversationHistory(context.chatId, limit);
        
        if (!dbHistory || dbHistory.length === 0) {
          return {
            success: true,
            data: 'אין היסטוריית הודעות זמינה',
            messages: []
          };
        }
        
        // Format DB history (same as before)
        const formattedHistory = dbHistory.map((msg, idx) => {
          let content = '';
          if (msg.content && msg.content.trim()) {
            content = `${msg.role === 'user' ? 'משתמש' : 'בוט'}: ${msg.content}`;
          } else {
            content = `${msg.role === 'user' ? 'משתמש' : 'בוט'}: [הודעה ללא טקסט]`;
          }
          
          if (msg.metadata) {
            if (msg.metadata.hasImage && msg.metadata.imageUrl) {
              content += ` [תמונה: image_id=${idx}, url=${msg.metadata.imageUrl}]`;
            } else if (msg.metadata.hasImage) {
              content += ' [תמונה מצורפת]';
            }
            
            if (msg.metadata.hasVideo && msg.metadata.videoUrl) {
              content += ` [וידאו: video_id=${idx}, url=${msg.metadata.videoUrl}]`;
            } else if (msg.metadata.hasVideo) {
              content += ' [וידאו מצורף]';
            }
            
            if (msg.metadata.hasAudio && msg.metadata.audioUrl) {
              content += ` [אודיו: audio_id=${idx}, url=${msg.metadata.audioUrl}]`;
              if (msg.metadata.transcribedText) {
                content += ` [תמלול: "${msg.metadata.transcribedText}"]`;
              }
            } else if (msg.metadata.hasAudio) {
              content += ' [הקלטה קולית]';
            }
          }
          
          return content;
        }).join('\n');
        
        return {
          success: true,
          data: `היסטוריה של ${dbHistory.length} הודעות אחרונות (מ-DB - רק פקודות):\n\n${formattedHistory}`,
          messages: dbHistory
        };
      }
      
      if (!greenApiHistory || greenApiHistory.length === 0) {
        return {
          success: true,
          data: 'אין היסטוריית הודעות זמינה',
          messages: []
        };
      }
      
      console.log(`✅ Retrieved ${greenApiHistory.length} messages from Green API`);
      
      // Format Green API history for the agent
      // Green API format: { typeMessage, textMessage, caption, senderName, senderId, timestamp, etc. }
      const formattedHistory = greenApiHistory
        .filter(msg => {
          // Filter out system/notification messages
          const isSystemMessage = 
            msg.typeMessage === 'notificationMessage' ||
            msg.type === 'notification' ||
            (msg.textMessage && msg.textMessage.startsWith('System:'));
          return !isSystemMessage;
        })
        .map((msg, idx) => {
          // Determine role: Check if message ID is in bot message cache
          // This is the most reliable way to identify bot messages
          const isFromBot = msg.idMessage ? messageTypeCache.isBotMessage(context.chatId, msg.idMessage) : false;
          
          const role = isFromBot ? 'בוט' : 'משתמש';
          const senderName = msg.senderName || (isFromBot ? 'בוט' : 'משתמש');
          
          // Extract text content
          let content = '';
          const textContent = msg.textMessage || 
                            msg.caption || 
                            (msg.extendedTextMessage && msg.extendedTextMessage.text) ||
                            (msg.typeMessage === 'extendedTextMessage' && msg.extendedTextMessage?.text);
          
          if (textContent && textContent.trim()) {
            content = `${role} (${senderName}): ${textContent}`;
          } else {
            content = `${role} (${senderName}): [הודעה ללא טקסט]`;
          }
          
          // Add media indicators
          if (msg.typeMessage === 'imageMessage' || msg.typeMessage === 'image') {
            const imageUrl = msg.downloadUrl || msg.urlFile || msg.imageMessageData?.downloadUrl;
            if (imageUrl) {
              content += ` [תמונה: image_id=${idx}, url=${imageUrl}]`;
            } else {
              content += ' [תמונה מצורפת]';
            }
          }
          
          if (msg.typeMessage === 'videoMessage' || msg.typeMessage === 'video') {
            const videoUrl = msg.downloadUrl || msg.urlFile || msg.videoMessageData?.downloadUrl;
            if (videoUrl) {
              content += ` [וידאו: video_id=${idx}, url=${videoUrl}]`;
            } else {
              content += ' [וידאו מצורף]';
            }
          }
          
          if (msg.typeMessage === 'audioMessage' || msg.typeMessage === 'audio') {
            const audioUrl = msg.downloadUrl || msg.urlFile || msg.audioMessageData?.downloadUrl;
            if (audioUrl) {
              content += ` [אודיו: audio_id=${idx}, url=${audioUrl}]`;
            } else {
              content += ' [הקלטה קולית]';
            }
          }
          
          // Add timestamp if available
          if (msg.timestamp) {
            const date = new Date(msg.timestamp * 1000);
            content += ` [${date.toLocaleString('he-IL')}]`;
          }
          
          return content;
        })
        .join('\n');
      
      // Convert Green API format to our internal format for compatibility
      const internalFormat = greenApiHistory
        .filter(msg => {
          const isSystemMessage = 
            msg.typeMessage === 'notificationMessage' ||
            msg.type === 'notification' ||
            (msg.textMessage && msg.textMessage.startsWith('System:'));
          return !isSystemMessage;
        })
        .map(msg => {
          // Determine role: Check if message ID is in bot message cache
          // This is the most reliable way to identify bot messages
          const isFromBot = msg.idMessage ? messageTypeCache.isBotMessage(context.chatId, msg.idMessage) : false;
          
          const textContent = msg.textMessage || 
                            msg.caption || 
                            (msg.extendedTextMessage && msg.extendedTextMessage.text) ||
                            (msg.typeMessage === 'extendedTextMessage' && msg.extendedTextMessage?.text);
          
          const metadata = {};
          if (msg.typeMessage === 'imageMessage' || msg.typeMessage === 'image') {
            metadata.hasImage = true;
            metadata.imageUrl = msg.downloadUrl || msg.urlFile || msg.imageMessageData?.downloadUrl;
          }
          if (msg.typeMessage === 'videoMessage' || msg.typeMessage === 'video') {
            metadata.hasVideo = true;
            metadata.videoUrl = msg.downloadUrl || msg.urlFile || msg.videoMessageData?.downloadUrl;
          }
          if (msg.typeMessage === 'audioMessage' || msg.typeMessage === 'audio') {
            metadata.hasAudio = true;
            metadata.audioUrl = msg.downloadUrl || msg.urlFile || msg.audioMessageData?.downloadUrl;
          }
          
          return {
            role: isFromBot ? 'assistant' : 'user',
            content: textContent || '',
            metadata: Object.keys(metadata).length > 0 ? metadata : {},
            timestamp: msg.timestamp || Date.now()
          };
        });
      
      return {
        success: true,
        data: `היסטוריה של ${internalFormat.length} הודעות אחרונות:\n\n${formattedHistory}`,
        messages: internalFormat  // Keep full history for follow-up tools
      };
    } catch (error) {
      console.error('❌ Error in get_chat_history tool:', error);
      return {
        success: false,
        error: `שגיאה בשליפת היסטוריה: ${error.message}`
      };
    }
  }
};

/**
 * Analyze image from history tool
 */
const analyze_image_from_history = {
  declaration: {
    name: 'analyze_image_from_history',
    description: 'נתח תמונה מהיסטוריית ההודעות. השתמש בכלי הזה אחרי ששלפת את היסטוריית ההודעות וראית שיש תמונה רלוונטית.',
    parameters: {
      type: 'object',
      properties: {
        image_id: {
          type: 'number',
          description: 'מזהה התמונה מההיסטוריה (המספר שמופיע ב-[image_id: X])',
        },
        question: {
          type: 'string',
          description: 'השאלה או הבקשה לגבי התמונה',
        }
      },
      required: ['image_id', 'question']
    }
  },
  execute: async (args, context) => {
    console.log(`🔧 [Agent Tool] analyze_image_from_history called with image_id: ${args.image_id}`);
    
    let imageBuffer = null;
    try {
      // Get the message with the image
      const history = context.previousToolResults?.get_chat_history?.messages;
      if (!history || !history[args.image_id]) {
        return {
          success: false,
          error: `לא נמצאה תמונה עם המזהה ${args.image_id}`
        };
      }
      
      const message = history[args.image_id];
      const imageUrl = message.metadata?.imageUrl;
      
      if (!imageUrl) {
        return {
          success: false,
          error: `ההודעה ${args.image_id} לא מכילה תמונה`
        };
      }
      
      // Download and analyze the image
      const { geminiService, greenApiService } = getServices();
      imageBuffer = await greenApiService.downloadFile(imageUrl);
      
      const result = await geminiService.analyzeImageWithText(args.question, imageBuffer);
      
      // Free memory
      imageBuffer = null;
      
      if (result.success) {
        return {
          success: true,
          data: result.text
        };
      } else {
        return {
          success: false,
          error: result.error || 'שגיאה בניתוח התמונה'
        };
      }
    } catch (error) {
      console.error('❌ Error in analyze_image_from_history tool:', error);
      // Free memory on error
      imageBuffer = null;
      return {
        success: false,
        error: `שגיאה בניתוח תמונה: ${error.message}`
      };
    }
  }
};

/**
 * Save user preference tool
 */
const save_user_preference = {
  declaration: {
    name: 'save_user_preference',
    description: 'שמור העדפת משתמש לטווח ארוך. השתמש כשמשתמש אומר "תמיד...", "אני מעדיף...", "בפעם הבאה...", "זכור ש...". דוגמאות: "תמיד צור תמונות עם OpenAI", "אני מעדיף וידאו קצרים", "זכור שאני לא אוהב חתולים".',
    parameters: {
      type: 'object',
      properties: {
        preference_key: {
          type: 'string',
          description: 'מפתח ההעדפה (למשל: "preferred_image_provider", "video_style", "dislikes")'
        },
        preference_value: {
          type: 'string',
          description: 'ערך ההעדפה'
        },
        description: {
          type: 'string',
          description: 'תיאור קצר של ההעדפה (אופציונלי)'
        }
      },
      required: ['preference_key', 'preference_value']
    }
  },
  execute: async (args, context) => {
    console.log(`🔧 [Agent Tool] save_user_preference called: ${args.preference_key} = ${args.preference_value}`);
    
    try {
      await conversationManager.saveUserPreference(
        context.chatId, 
        args.preference_key, 
        args.preference_value
      );
      
      return {
        success: true,
        data: `✅ שמרתי את ההעדפה: ${args.preference_key} = ${args.preference_value}`
      };
    } catch (error) {
      console.error('❌ Error in save_user_preference tool:', error);
      return {
        success: false,
        error: `שגיאה בשמירת העדפה: ${error.message}`
      };
    }
  }
};

/**
 * Get long-term memory tool
 */
const get_long_term_memory = {
  declaration: {
    name: 'get_long_term_memory',
    description: 'קרא זיכרון ארוך טווח - סיכומי שיחות קודמות והעדפות משתמש. השתמש כשצריך להבין הקשר רחב יותר או לבדוק מה המשתמש אוהב/לא אוהב.',
    parameters: {
      type: 'object',
      properties: {
        include_summaries: {
          type: 'boolean',
          description: 'האם לכלול סיכומי שיחות קודמות (ברירת מחדל: true)',
        },
        include_preferences: {
          type: 'boolean',
          description: 'האם לכלול העדפות משתמש (ברירת מחדל: true)',
        }
      },
      required: []
    }
  },
  execute: async (args, context) => {
    console.log(`🔧 [Agent Tool] get_long_term_memory called`);
    
    try {
      const includeSummaries = args.include_summaries !== false;
      const includePreferences = args.include_preferences !== false;
      
      let result = {
        success: true,
        data: ''
      };
      
      // Get summaries
      if (includeSummaries) {
        const summaries = await conversationManager.getConversationSummaries(context.chatId, 5);
        
        if (summaries.length > 0) {
          result.data += '📚 סיכומי שיחות קודמות:\n\n';
          summaries.forEach((summary, idx) => {
            result.data += `${idx + 1}. ${summary.summary}\n`;
            if (summary.keyTopics && summary.keyTopics.length > 0) {
              result.data += `   נושאים: ${summary.keyTopics.join(', ')}\n`;
            }
            result.data += '\n';
          });
          result.summaries = summaries;
        } else {
          result.data += '📚 אין סיכומי שיחות קודמות\n\n';
        }
      }
      
      // Get preferences
      if (includePreferences) {
        const preferences = await conversationManager.getUserPreferences(context.chatId);
        
        if (Object.keys(preferences).length > 0) {
          result.data += '⚙️ העדפות משתמש:\n';
          for (const [key, value] of Object.entries(preferences)) {
            result.data += `   • ${key}: ${value}\n`;
          }
          result.preferences = preferences;
        } else {
          result.data += '⚙️ אין העדפות משתמש שמורות';
        }
      }
      
      return result;
    } catch (error) {
      console.error('❌ Error in get_long_term_memory tool:', error);
      return {
        success: false,
        error: `שגיאה בגישה לזיכרון ארוך טווח: ${error.message}`
      };
    }
  }
};

module.exports = {
  get_chat_history,
  analyze_image_from_history,
  save_user_preference,
  get_long_term_memory
};

