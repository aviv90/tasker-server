/**
 * WhatsApp Messaging Functions
 * 
 * Handles message sending and acknowledgments:
 * - sendAck: Sends acknowledgment messages for different command types
 * 
 * Extracted from whatsappRoutes.js for better modularity and to avoid circular dependencies
 */

import { sendTextMessage } from '../greenApiService';
import logger from '../../utils/logger';

/**
 * Command object structure
 */
interface Command {
  type: string;
  model?: string;
  withRhyme?: boolean;
  originalMessageId?: string;
}

/**
 * Send acknowledgment message for a command
 * @param chatId - WhatsApp chat ID
 * @param command - Command object with type and optional parameters
 */
export async function sendAck(chatId: string, command: Command): Promise<void> {
  let ackMessage = '';
  
  switch (command.type) {
    // ═══════════════════ AGENT MODE ═══════════════════
    case 'agent_query':
      ackMessage = '🤖 קיבלתי! מעבד עם AI Agent מתקדם...';
      break;
      
    // ═══════════════════ CHAT ═══════════════════
    case 'gemini_chat':
      ackMessage = '💬 קיבלתי. מעבד עם Gemini...';
      break;
    case 'openai_chat':
      ackMessage = '💬 קיבלתי. מעבד עם OpenAI...';
      break;
    case 'grok_chat':
      ackMessage = '💬 קיבלתי. מעבד עם Grok...';
      break;
      
    // ═══════════════════ IMAGE GENERATION ═══════════════════
    case 'gemini_image':
      ackMessage = '🎨 קיבלתי! מייצר תמונה עם Gemini...';
      break;
    case 'openai_image':
      ackMessage = '🎨 קיבלתי! מייצר תמונה עם OpenAI...';
      break;
    case 'grok_image':
      ackMessage = '🎨 קיבלתי! מייצר תמונה עם Grok...';
      break;
      
    // ═══════════════════ VIDEO GENERATION ═══════════════════
    case 'veo3_video':
      ackMessage = '🎬 קיבלתי! יוצר וידאו עם Veo 3...';
      break;
    case 'sora_video':
      // Check if using Pro model from command.model
      ackMessage = command.model === 'sora-2-pro' 
        ? '🎬 קיבלתי! יוצר וידאו עם Sora 2 Pro...' 
        : '🎬 קיבלתי! יוצר וידאו עם Sora 2...';
      break;
    case 'kling_text_to_video':
      ackMessage = '🎬 קיבלתי! יוצר וידאו עם Kling AI...';
      break;
    case 'veo3_image_to_video':
      ackMessage = '🎬 יוצר וידאו עם Veo 3...';
      break;
    case 'sora_image_to_video':
      // Check if using Pro model from command.model
      ackMessage = command.model === 'sora-2-pro' 
        ? '🎬 יוצר וידאו עם Sora 2 Pro...' 
        : '🎬 יוצר וידאו עם Sora 2...';
      break;
    case 'kling_image_to_video':
      ackMessage = '🎬 יוצר וידאו עם Kling AI...';
      break;
    case 'runway_video_to_video':
      ackMessage = '🎬 עובד על הווידאו עם RunwayML Gen4...';
      break;
      
    // ═══════════════════ AUDIO & VOICE ═══════════════════
    case 'translate_text':
      ackMessage = '🌐 קיבלתי! מתרגם עם Gemini...';
      break;
    case 'text_to_speech':
      ackMessage = '🗣️ קיבלתי! מתרגם ומייצר דיבור עם ElevenLabs...';
      break;
    case 'voice_processing':
      ackMessage = '🎤 מעבד ומכין תשובה...';
      break;
    case 'voice_generation':
      ackMessage = '🎤 קיבלתי! מייצר קול עם ElevenLabs...';
      break;
    case 'creative_voice_processing':
      ackMessage = '🎨 מתחיל עיבוד יצירתי עם אפקטים ומוזיקה...';
      break;
    case 'voice_cloning_response':
      ackMessage = '🎤 קיבלתי! מתחיל שיבוט קול ויצירת תגובה...';
      break;
      
    // ═══════════════════ MUSIC ═══════════════════
    case 'music_generation':
      ackMessage = '🎵 קיבלתי! מתחיל יצירת שיר עם Suno AI... 🎶';
      break;
      
    // ═══════════════════ UTILITIES ═══════════════════
    case 'chat_summary':
      ackMessage = '📝 קיבלתי! מכין סיכום השיחה עם Gemini...';
      break;
    
    case 'retry_last_command':
      ackMessage = '🔄 קיבלתי! מריץ שוב את הפקודה האחרונה...';
      break;
    
    case 'create_poll':
      ackMessage = command.withRhyme === false 
        ? '📊 קיבלתי! יוצר סקר יצירתי...' 
        : '📊 קיבלתי! יוצר סקר יצירתי עם חרוזים...';
      break;
    
    case 'send_random_location':
      ackMessage = '🌍 קיבלתי! בוחר מיקום אקראי על כדור הארץ...';
      break;
      
    default:
      return; // No ACK needed for this command
  }
  
  try {
    // Get quotedMessageId from command context if available
    const quotedMessageId = command.originalMessageId || null;
    await sendTextMessage(chatId, ackMessage, quotedMessageId, 1000);
    logger.info(`✅ ACK sent for ${command.type}`, { chatId, commandType: command.type });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Error sending ACK:', { error: errorMessage, chatId, commandType: command.type });
  }
}

