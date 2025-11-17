/**
 * Conversation summaries and long-term memory management
 */
class SummariesManager {
  constructor(conversationManager) {
    this.conversationManager = conversationManager;
  }

  /**
   * Generate automatic summary using Gemini AI
   * @param {string} chatId - Chat ID
   * @returns {Object} - Generated summary or error
   */
  async generateAutomaticSummary(chatId) {
    if (!this.conversationManager.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot generate summary');
      return { error: 'Database not initialized' };
    }

    try {
      // Get recent chat history from DB (DB format: { role, content, metadata })
      const history = await this.conversationManager.messagesManager.getConversationHistory(chatId);
      
      if (!history || history.length < 10) {
        console.log(`⏭️ [Auto-Summary] Not enough messages (${history?.length || 0}) for chat ${chatId}`);
        return { error: 'Not enough messages for summary' };
      }

      // Format history for Gemini (DB format has role and content)
      const conversationText = history.map(msg => 
        `${msg.role === 'user' ? 'User' : 'Bot'}: ${msg.content}`
      ).join('\n');

      // Generate summary using Gemini
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

      const result = await geminiText(summaryPrompt);
      
      if (result.error) {
        console.error('❌ Failed to generate summary:', result.error);
        return { error: result.error };
      }

      // Parse JSON response
      let summaryData;
      try {
        // Try to extract JSON from response
        const jsonMatch = result.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          summaryData = JSON.parse(jsonMatch[0]);
        } else {
          summaryData = JSON.parse(result.text);
        }
      } catch (parseError) {
        console.error('❌ Failed to parse summary JSON:', parseError);
        // Fallback: create basic summary
        summaryData = {
          summary: result.text.substring(0, 500),
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

      console.log(`✅ [Auto-Summary] Generated and saved summary for chat ${chatId}`);
      return {
        success: true,
        summary: summaryData.summary,
        keyTopics: summaryData.keyTopics,
        userPreferences: summaryData.userPreferences
      };
    } catch (error) {
      console.error('❌ Error generating automatic summary:', error.message);
      return { error: error.message };
    }
  }

  /**
   * Save conversation summary for long-term memory
   */
  async saveConversationSummary(chatId, summary, keyTopics = [], userPreferences = {}, messageCount = 0) {
    if (!this.conversationManager.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot save summary');
      return;
    }

    const client = await this.conversationManager.pool.connect();
    
    try {
      await client.query(`
        INSERT INTO conversation_summaries 
        (chat_id, summary, key_topics, user_preferences, message_count, summary_date)
        VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      `, [
        chatId,
        summary,
        JSON.stringify(keyTopics),
        JSON.stringify(userPreferences),
        messageCount
      ]);

      console.log(`📝 [Long-term Memory] Saved summary for chat ${chatId}`);
    } catch (error) {
      console.error('❌ Error saving conversation summary:', error.message);
    } finally {
      client.release();
    }
  }

  /**
   * Get recent conversation summaries for a chat
   */
  async getConversationSummaries(chatId, limit = 5) {
    if (!this.conversationManager.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot get summaries');
      return [];
    }

    const client = await this.conversationManager.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT summary, key_topics, user_preferences, message_count, summary_date
        FROM conversation_summaries
        WHERE chat_id = $1
        ORDER BY summary_date DESC
        LIMIT $2
      `, [chatId, limit]);
      
      return result.rows.map(row => ({
        summary: row.summary,
        keyTopics: row.key_topics || [],
        userPreferences: row.user_preferences || {},
        messageCount: row.message_count,
        summaryDate: row.summary_date
      }));
    } catch (error) {
      console.error('❌ Error getting conversation summaries:', error.message);
      return [];
    } finally {
      client.release();
    }
  }

  /**
   * Get aggregated user preferences from all summaries
   */
  async getUserPreferences(chatId) {
    if (!this.conversationManager.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot get user preferences');
      return {};
    }

    const client = await this.conversationManager.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT user_preferences
        FROM conversation_summaries
        WHERE chat_id = $1
        ORDER BY summary_date DESC
        LIMIT 10
      `, [chatId]);
      
      // Merge all preferences (most recent takes precedence)
      const merged = {};
      for (const row of result.rows.reverse()) {
        Object.assign(merged, row.user_preferences || {});
      }
      
      return merged;
    } catch (error) {
      console.error('❌ Error getting user preferences:', error.message);
      return {};
    } finally {
      client.release();
    }
  }

  /**
   * Save a single user preference
   * Updates the most recent summary's user_preferences, or creates a basic summary if none exists
   */
  async saveUserPreference(chatId, preferenceKey, preferenceValue) {
    if (!this.conversationManager.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot save user preference');
      return;
    }

    const client = await this.conversationManager.pool.connect();
    
    try {
      // Get the most recent summary for this chat
      const result = await client.query(`
        SELECT id, user_preferences
        FROM conversation_summaries
        WHERE chat_id = $1
        ORDER BY summary_date DESC
        LIMIT 1
      `, [chatId]);

      if (result.rows.length > 0) {
        // Update existing summary's user_preferences
        const currentPreferences = result.rows[0].user_preferences || {};
        currentPreferences[preferenceKey] = preferenceValue;

        await client.query(`
          UPDATE conversation_summaries
          SET user_preferences = $1, summary_date = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [JSON.stringify(currentPreferences), result.rows[0].id]);

        console.log(`💾 [User Preference] Updated for chat ${chatId}: ${preferenceKey} = ${preferenceValue}`);
      } else {
        // Create a basic summary with just this preference
        await client.query(`
          INSERT INTO conversation_summaries 
          (chat_id, summary, key_topics, user_preferences, message_count, summary_date)
          VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
        `, [
          chatId,
          'User preferences saved',
          [],
          JSON.stringify({ [preferenceKey]: preferenceValue }),
          0
        ]);

        console.log(`💾 [User Preference] Created new summary for chat ${chatId}: ${preferenceKey} = ${preferenceValue}`);
      }
    } catch (error) {
      console.error('❌ Error saving user preference:', error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Clean up old conversation summaries (keep only recent N per chat)
   * @param {number} keepPerChat - Keep N most recent summaries per chat (default: 10)
   * @returns {number} - Number of rows deleted
   */
  async cleanupOldSummaries(keepPerChat = 10) {
    if (!this.conversationManager.isInitialized) {
      console.warn('⚠️ Database not initialized, cannot cleanup summaries');
      return 0;
    }

    const client = await this.conversationManager.pool.connect();
    
    try {
      // Delete summaries that are not in the top N for each chat_id
      const result = await client.query(`
        DELETE FROM conversation_summaries
        WHERE id NOT IN (
          SELECT id
          FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY summary_date DESC) as rn
            FROM conversation_summaries
          ) ranked
          WHERE rn <= $1
        )
        RETURNING id
      `, [keepPerChat]);

      const deletedCount = result.rowCount || 0;
      if (deletedCount > 0) {
        console.log(`🧹 [Summary Cleanup] Deleted ${deletedCount} old summaries (kept ${keepPerChat} per chat)`);
      } else {
        console.log(`✅ [Summary Cleanup] No old summaries to delete`);
      }

      return deletedCount;
    } catch (error) {
      console.error('❌ Error cleaning up old summaries:', error.message);
      return 0;
    } finally {
      client.release();
    }
  }
}

module.exports = SummariesManager;

