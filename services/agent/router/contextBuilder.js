/**
 * Context Builder
 * Builds contextual prompts for the agent based on input
 */

const conversationManager = require('../../conversationManager');
const { summarizeLastCommand } = require('../utils/resultUtils');
const { parseJSONSafe } = require('../utils/resultUtils');

/**
 * Build contextual prompt for agent
 * @param {Object} input - Normalized input from webhook
 * @param {string} chatId - Chat ID for context
 * @returns {Promise<string>} - Contextual prompt
 */
async function buildContextualPrompt(input, chatId) {
  const userText = input.userText || '';
  
  // Fetch last command for context-aware behaviour (from DB, persistent)
  const lastCommandRaw = await conversationManager.getLastCommand(chatId);
  let parsedLastCommand = null;
  if (lastCommandRaw) {
    parsedLastCommand = {
      tool: lastCommandRaw.tool,
      args: lastCommandRaw.toolArgs || lastCommandRaw.args,
      normalized: lastCommandRaw.normalized,
      prompt: lastCommandRaw.prompt,
      failed: lastCommandRaw.failed,
      imageUrl: lastCommandRaw.imageUrl,
      videoUrl: lastCommandRaw.videoUrl,
      audioUrl: lastCommandRaw.audioUrl,
      isMultiStep: lastCommandRaw.isMultiStep,
      plan: lastCommandRaw.plan
    };
  }
  
  // Detect if we should skip loading conversation history
  const shouldSkipHistory = 
    input.hasImage || 
    input.hasVideo || 
    input.hasAudio ||
    input.quotedContext;
  
  // NOTE: Conversation history is now retrieved from Green API via get_chat_history tool
  // We no longer use DB for conversation history to avoid duplication
  // History is loaded dynamically when needed by the agent via the get_chat_history tool
  // This avoids duplication and ensures we always have the latest messages from Green API
  let conversationHistory = '';
  // History is loaded on-demand via get_chat_history tool, not pre-loaded here
  
  // Build context for the agent
  let contextualPrompt = buildMediaContext(input, userText);
  
  // Add authorization context
  const authContext = buildAuthContext(input);
  if (authContext) {
    contextualPrompt += `\n\n[הרשאות: ${authContext}]`;
  }

  // Add last command summary
  if (parsedLastCommand) {
    const summary = summarizeLastCommand(parsedLastCommand);
    if (summary) {
      contextualPrompt += `\n\n[פקודה קודמת]: ${summary}`;
    }
  }
  
  // Add conversation history at the end
  if (conversationHistory) {
    contextualPrompt += conversationHistory;
  }
  
  return contextualPrompt;
}

/**
 * Build media context from input
 */
function buildMediaContext(input, userText) {
  // Handle quoted messages
  if (input.quotedContext) {
    return buildQuotedMessageContext(input, userText);
  }
  
  // Handle current media attachments
  if (input.hasImage && !input.quotedContext) {
    return buildImageContext(input, userText);
  } else if (input.hasVideo && !input.quotedContext) {
    return buildVideoContext(input, userText);
  } else if (input.hasAudio && !input.quotedContext) {
    return buildAudioContext(input, userText);
  }
  
  return userText;
}

/**
 * Build context for quoted messages
 */
function buildQuotedMessageContext(input, userText) {
  const quoted = input.quotedContext;
  
  if (quoted.hasImage && quoted.imageUrl) {
    return `[הודעה מצוטטת: תמונה - image_url: ${quoted.imageUrl}]\n${quoted.text || '(תמונה)'}\n\n[בקשה נוכחית:]\n${userText}\n\n**IMPORTANT: User quoted an image with image_url provided above. Based on the request:\n- For analysis/questions (מה זה, תאר, explain, analyze, describe, what is): use analyze_image with image_url: "${quoted.imageUrl}"\n- For edits (ערוך, שנה, הסר, הוסף, edit, change, remove, add): use edit_image with image_url: "${quoted.imageUrl}"\n- DO NOT use retry_last_command unless user explicitly said "נסה שוב" or "שוב"**`;
  } else if (quoted.hasImage) {
    return `[הודעה מצוטטת: תמונה]\n${quoted.text || '(תמונה)'}\n\n[בקשה נוכחית:]\n${userText}`;
  }
  
  if (quoted.hasVideo && quoted.videoUrl) {
    return `[הודעה מצוטטת: וידאו - video_url: ${quoted.videoUrl}]\n${quoted.text || '(וידאו)'}\n\n[בקשה נוכחית:]\n${userText}\n\n**IMPORTANT: User quoted a video with video_url provided above. Use analyze_video with video_url: "${quoted.videoUrl}" and question parameter from the current request.**`;
  } else if (quoted.hasVideo) {
    return `[הודעה מצוטטת: וידאו]\n${quoted.text || '(וידאו)'}\n\n[בקשה נוכחית:]\n${userText}`;
  }
  
  if (quoted.hasAudio && quoted.audioUrl) {
    return `[הודעה מצוטטת: הקלטה קולית - audio_url: ${quoted.audioUrl || 'לא זמין'}]\n${quoted.text || '(הקלטה)'}\n\n[בקשה נוכחית:]\n${userText}\n\n**IMPORTANT: User quoted audio. Use transcribe_audio with audio_url: "${quoted.audioUrl}" if available.**`;
  }
  
  return `[הודעה מצוטטת: ${quoted.type}]\n${quoted.text || ''}\n\n[בקשה נוכחית:]\n${userText}`;
}

/**
 * Build context for image attachments
 */
function buildImageContext(input, userText) {
  if (input.imageUrl) {
    return `${userText}\n\n**IMPORTANT: User attached an image. Based on the request:\n- For analysis/questions (מה זה, תאר, explain, analyze, describe): use analyze_image with image_url: "${input.imageUrl}"\n- For edits/generation with image (ערוך, שנה, הסר, הוסף, edit, change): use edit_image with image_url: "${input.imageUrl}"**`;
  }
  return `[המשתמש שלח תמונה] ${userText}`;
}

/**
 * Build context for video attachments
 */
function buildVideoContext(input, userText) {
  if (input.videoUrl) {
    return `${userText}\n\n**IMPORTANT: User attached a video. Use analyze_video with video_url: "${input.videoUrl}" and extract the question from the user's text above.**`;
  }
  return `[המשתמש שלח וידאו] ${userText}`;
}

/**
 * Build context for audio attachments
 */
function buildAudioContext(input, userText) {
  if (input.audioUrl) {
    return `${userText}\n\n**IMPORTANT: User attached audio. Use transcribe_audio with audio_url: "${input.audioUrl}" to transcribe it first.**`;
  }
  return `[המשתמש שלח הקלטה קולית] ${userText}`;
}

/**
 * Build authorization context
 */
function buildAuthContext(input) {
  const authContext = [];
  if (input.authorizations?.media_creation) {
    authContext.push('מורשה ליצירת מדיה (תמונות/וידאו/מוזיקה)');
  }
  if (input.authorizations?.group_creation) {
    authContext.push('מורשה ליצירת קבוצות');
  }
  if (input.authorizations?.voice_allowed) {
    authContext.push('מורשה לשימוש בכלי קול');
  }
  return authContext.length > 0 ? authContext.join(', ') : null;
}

module.exports = {
  buildContextualPrompt
};

