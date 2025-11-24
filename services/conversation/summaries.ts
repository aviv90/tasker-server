/**
 * Conversation summaries and long-term memory management
 */

import logger from '../../utils/logger';
import SummariesRepository from '../../repositories/summariesRepository';
import { getChatHistory } from '../../utils/chatHistoryService';

/**
 * Conversation manager interface (for backward compatibility)
 */
interface ConversationManager {
  [key: string]: unknown;
}

/**
 * Summary data structure
 */
interface SummaryData {
  summary: string;
  keyTopics: string[];
  userPreferences: Record<string, unknown>;
}

/**
 * Generate summary result
 */
interface GenerateSummaryResult {
  success?: boolean;
  summary?: string;
  keyTopics?: string[];
  userPreferences?: Record<string, unknown>;
  error?: string;
}

class SummariesManager {
  // @ts-expect-error - Kept for backward compatibility (unused)
  private _conversationManager: ConversationManager;
  private repository: SummariesRepository | null;

  constructor(conversationManager: ConversationManager, repository: SummariesRepository | null) {
    this._conversationManager = conversationManager;
    this.repository = repository;
  }

  /**
   * Generate automatic summary using Gemini AI
   * @param chatId - Chat ID
   * @returns Generated summary or error
   */
  async generateAutomaticSummary(chatId: string): Promise<GenerateSummaryResult> {
    if (!this.repository) {
      logger.warn('⚠️ Repository not initialized, cannot generate summary');
      return { error: 'Repository not initialized' };
    }

    try {
      // Get recent chat history from Green API or legacy
      // Note: Ideally this service should depend on chatHistoryService, not messagesManager
      const historyResult = await getChatHistory(chatId);
      const history = historyResult.messages;
      
      if (!history || history.length < 10) {
        logger.debug(`⏭️ [Auto-Summary] Not enough messages (${history?.length || 0}) for chat ${chatId}`);
        return { error: 'Not enough messages for summary' };
      }

      // Format history for Gemini
      const conversationText = history.map(msg => 
        `${msg.role === 'user' ? 'User' : 'Bot'}: ${msg.content}`
      ).join('\n');

      // Generate summary using Gemini
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { generateTextResponse: geminiText } = require('../geminiService');
      
      const summaryPrompt = `נתח את השיחה הבאה וצור סיכום מובנה:

${conversationText}

החזר JSON בפורמט הבא (רק JSON, ללא טקסט נוסף):
{
  "summary": "סיכום קצר של השיחה (2-3 משפטים)",
  "keyTopics": ["נושא 1", "נושא 2", "נושא 3"],
  "userPreferences": {
    "key": "value"
  }
}

הערות:
- summary: תאר את מה שדובר בשיחה באופן תמציתי
- keyTopics: 3-5 נושאים מרכזיים שדובר עליהם
- userPreferences: זהה העדפות משתמש (סגנון, ספקים מועדפים, נושאים שחוזרים)
- אם אין העדפות ברורות, החזר אובייקט ריק {}`;

      const result = await geminiText(summaryPrompt) as { error?: string; text?: string };
      
      if (result.error) {
        logger.error('❌ Failed to generate summary:', { error: result.error });
        return { error: result.error };
      }

      // Parse JSON response
      let summaryData: SummaryData;
      try {
        // Try to extract JSON from response
        const jsonMatch = result.text?.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          summaryData = JSON.parse(jsonMatch[0]) as SummaryData;
        } else if (result.text) {
          summaryData = JSON.parse(result.text) as SummaryData;
        } else {
          throw new Error('No text in result');
        }
      } catch (parseError: unknown) {
        const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
        logger.error('❌ Failed to parse summary JSON:', { error: errorMessage });
        // Fallback: create basic summary
        summaryData = {
          summary: result.text?.substring(0, 500) || 'No summary available',
          keyTopics: [],
          userPreferences: {}
        };
      }

      // Save to database
      await this.saveConversationSummary(
        chatId,
        summaryData.summary,
        summaryData.keyTopics || [],
        summaryData.userPreferences || {},
        history.length
      );

      logger.info(`✅ [Auto-Summary] Generated and saved summary for chat ${chatId}`);
      return {
        success: true,
        summary: summaryData.summary,
        keyTopics: summaryData.keyTopics,
        userPreferences: summaryData.userPreferences
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error generating automatic summary:', { error: errorMessage });
      return { error: errorMessage };
    }
  }

  /**
   * Save conversation summary for long-term memory
   */
  async saveConversationSummary(
    chatId: string, 
    summary: string, 
    keyTopics: string[] = [], 
    userPreferences: Record<string, unknown> = {}, 
    messageCount: number = 0
  ): Promise<void> {
    if (!this.repository) {
      logger.warn('⚠️ Repository not initialized, cannot save summary');
      return;
    }

    try {
      const summaryData = {
        chatId,
        summary,
        keyTopics,
        userPreferences,
        messageCount
      };

      await this.repository.save(summaryData);
      logger.debug(`📝 [Long-term Memory] Saved summary for chat ${chatId}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error saving conversation summary:', { error: errorMessage });
    }
  }

  /**
   * Get recent conversation summaries for a chat
   */
  async getConversationSummaries(chatId: string, limit: number = 5): Promise<unknown[]> {
    if (!this.repository) {
      logger.warn('⚠️ Repository not initialized, cannot get summaries');
      return [];
    }

    try {
      return await this.repository.findByChatId(chatId, limit);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error getting conversation summaries:', { error: errorMessage });
      return [];
    }
  }

  /**
   * Get aggregated user preferences from all summaries
   */
  async getUserPreferences(chatId: string): Promise<Record<string, unknown>> {
    if (!this.repository) {
      logger.warn('⚠️ Repository not initialized, cannot get user preferences');
      return {};
    }

    try {
      const preferencesList = await this.repository.findPreferences(chatId, 10);
      
      // Merge all preferences (most recent takes precedence)
      const merged: Record<string, unknown> = {};
      for (const prefs of preferencesList.reverse()) {
        if (prefs && typeof prefs === 'object') {
          Object.assign(merged, prefs as Record<string, unknown>);
        }
      }
      
      return merged;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error getting user preferences:', { error: errorMessage });
      return {};
    }
  }

  /**
   * Save a single user preference
   * Updates the most recent summary's user_preferences, or creates a basic summary if none exists
   */
  async saveUserPreference(chatId: string, preferenceKey: string, preferenceValue: unknown): Promise<void> {
    if (!this.repository) {
      logger.warn('⚠️ Repository not initialized, cannot save user preference');
      return;
    }

    try {
      // Get the most recent summary for this chat
      const summaries = await this.repository.findByChatId(chatId, 1);

      if (summaries.length > 0) {
        // Update existing summary's user_preferences
        const summary = summaries[0] as { id?: number; userPreferences?: Record<string, unknown> };
        const currentPreferences = (summary.userPreferences || {}) as Record<string, unknown>;
        currentPreferences[preferenceKey] = preferenceValue;

        if (summary.id) {
          await this.repository.updatePreferences(summary.id, currentPreferences);
        }
        logger.debug(`💾 [User Preference] Updated for chat ${chatId}: ${preferenceKey} = ${preferenceValue}`);
      } else {
        // Create a basic summary with just this preference
        await this.saveConversationSummary(
          chatId,
          'User preferences saved',
          [],
          { [preferenceKey]: preferenceValue },
          0
        );
        logger.debug(`💾 [User Preference] Created new summary for chat ${chatId}: ${preferenceKey} = ${preferenceValue}`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error saving user preference:', { error: errorMessage });
      throw error;
    }
  }

  /**
   * Clean up old conversation summaries (keep only recent N per chat)
   * @param keepPerChat - Keep N most recent summaries per chat (default: 10)
   * @returns Number of rows deleted
   */
  async cleanupOldSummaries(keepPerChat: number = 10): Promise<number> {
    if (!this.repository) {
      logger.warn('⚠️ Repository not initialized, cannot cleanup summaries');
      return 0;
    }

    try {
      const deletedCount = await this.repository.deleteOldSummaries(keepPerChat);
      
      if (deletedCount > 0) {
        logger.info(`🧹 [Summary Cleanup] Deleted ${deletedCount} old summaries (kept ${keepPerChat} per chat)`);
      } else {
        logger.debug('✅ [Summary Cleanup] No old summaries to delete');
      }

      return deletedCount;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error cleaning up old summaries:', { error: errorMessage });
      return 0;
    }
  }
}

export default SummariesManager;

