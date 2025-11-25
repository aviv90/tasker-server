import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Chat message
 */
interface ChatMessage {
  timestamp?: number | string;
  timestampMessage?: number | string;
  chatName?: string;
  senderName?: string;
  sender?: string;
  textMessage?: string;
  caption?: string;
  typeMessage?: string;
  extendedTextMessage?: {
    text?: string;
  };
  [key: string]: unknown;
}

/**
 * Summary result
 */
interface SummaryResult {
  success: boolean;
  text?: string;
  error?: string;
}

/**
 * Chat summary generation
 */
class SummaryService {
  /**
   * Generate chat summary using Gemini
   */
  async generateChatSummary(messages: ChatMessage[]): Promise<SummaryResult> {
    try {
      console.log(`📝 Generating chat summary for ${messages.length} messages`);
      
      // Format messages for Gemini
      let formattedMessages = '';
      messages.forEach((msg, index) => {
        // Handle timestamp - Green API can return seconds or milliseconds
        let timestamp: Date;
        if (msg.timestamp) {
          // If timestamp is less than year 2000 in milliseconds, it's probably in seconds
          const ts = typeof msg.timestamp === 'number' ? msg.timestamp : parseInt(String(msg.timestamp));
          timestamp = ts < 946684800000 ? new Date(ts * 1000) : new Date(ts);
        } else if (msg.timestampMessage) {
          // Alternative timestamp field
          const ts = typeof msg.timestampMessage === 'number' ? msg.timestampMessage : parseInt(String(msg.timestampMessage));
          timestamp = ts < 946684800000 ? new Date(ts * 1000) : new Date(ts);
        } else {
          timestamp = new Date(); // Fallback to current time
        }
        const timestampStr = timestamp.toLocaleString('he-IL');
        
        // Use WhatsApp display name only (chatName), fallback to phone number
        let sender = 'משתמש';
        if (msg.chatName) {
          sender = msg.chatName;
        } else if (msg.senderName) {
          sender = msg.senderName;
        } else if (msg.sender) {
          // Extract phone number from sender ID (e.g., "972543995202@c.us" -> "972543995202")
          const phoneMatch = String(msg.sender).match(/^(\d+)@/);
          sender = phoneMatch && phoneMatch[1] ? phoneMatch[1] : String(msg.sender);
        }
        
        // Get message text - Green API format
        let messageText = msg.textMessage || msg.caption || '';
        
        // If no text found, check extendedTextMessage
        if (!messageText && msg.typeMessage === 'extendedTextMessage' && msg.extendedTextMessage) {
          messageText = msg.extendedTextMessage.text || '';
        }
        
        // If no text, determine media type and create descriptive label
        if (!messageText) {
          let mediaType = '[מדיה]';
          
          // Detect media type from Green API format
          if (msg.typeMessage === 'imageMessage' || msg.typeMessage === 'stickerMessage') {
            mediaType = '[תמונה]';
          } else if (msg.typeMessage === 'videoMessage') {
            mediaType = '[וידאו]';
          } else if (msg.typeMessage === 'audioMessage' || msg.typeMessage === 'pttMessage') {
            mediaType = '[אודיו]';
          } else if (msg.typeMessage === 'documentMessage') {
            mediaType = '[קובץ]';
          } else if (msg.typeMessage === 'locationMessage') {
            mediaType = '[מיקום]';
          } else if (msg.typeMessage === 'contactMessage') {
            mediaType = '[איש קשר]';
          } else if (msg.typeMessage) {
            // Generic media type based on typeMessage
            const typeMsg = String(msg.typeMessage);
            mediaType = `[${typeMsg.replace('Message', '')}]`;
          }
          
          // Add caption if exists (for media with caption)
          if (msg.caption) {
            messageText = `${mediaType} - ${msg.caption}`;
          } else {
            messageText = mediaType;
          }
        } else {
          // Text message - check if it also has media
          let mediaIndicator = '';
          if (msg.typeMessage === 'imageMessage' || msg.typeMessage === 'stickerMessage') {
            mediaIndicator = ' [עם תמונה]';
          } else if (msg.typeMessage === 'videoMessage') {
            mediaIndicator = ' [עם וידאו]';
          } else if (msg.typeMessage === 'audioMessage' || msg.typeMessage === 'pttMessage') {
            mediaIndicator = ' [עם אודיו]';
          } else if (msg.typeMessage === 'documentMessage') {
            mediaIndicator = ' [עם קובץ]';
          }
          messageText = messageText + mediaIndicator;
        }
        
        formattedMessages += `${index + 1}. ${timestampStr} - ${sender}: ${messageText}\n`;
      });
      
      const summaryPrompt = `אנא צור סיכום קצר וברור של השיחה הבאה. התמקד בנושאים העיקריים, החלטות שהתקבלו, ונקודות חשובות.

חשוב: הסיכום חייב להיות בעברית.

הוראות:
- אם יש הודעות מדיה (תמונה, וידאו, אודיו) - ציין שהשיחה כללה גם מדיה, אבל אל תנתח את תוכן המדיה אלא אם כן המשתמש ביקש זאת במפורש
- התמקד בתוכן הטקסטואלי של השיחה
- אם יש caption למדיה - השתמש בו כחלק מההקשר

הודעות השיחה:
${formattedMessages}

סיכום השיחה:`;

      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const result = await model.generateContent(summaryPrompt);
      
      if (!result.response) {
        throw new Error('No response from Gemini');
      }
      
      const summaryText = result.response.text();
      console.log(`✅ Chat summary generated: ${summaryText.length} characters`);
      
      return {
        success: true,
        text: summaryText
      };
      
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Chat summary generation failed';
      console.error('❌ Chat summary generation error:', err);
      return {
        success: false,
        error: errorMessage
      };
    }
  }
}

export default new SummaryService();

