/**
 * Context Builder
 * Builds contextual prompts for the agent based on input
 */

import conversationManager from '../../conversationManager';
import { summarizeLastCommand } from '../utils/resultUtils';

type QuotedContext = {
  hasImage?: boolean;
  imageUrl?: string;
  hasVideo?: boolean;
  videoUrl?: string;
  hasAudio?: boolean;
  audioUrl?: string;
  text?: string;
  type?: string;
  [key: string]: unknown;
};

type NormalizedInput = {
  userText?: string;
  hasImage?: boolean;
  hasVideo?: boolean;
  hasAudio?: boolean;
  imageUrl?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  authorizations?: {
    media_creation?: boolean;
    group_creation?: boolean;
    voice_allowed?: boolean;
    [key: string]: unknown;
  };
  quotedContext?: QuotedContext;
  [key: string]: unknown;
};

type LastCommandSummary = {
  tool?: string;
  args?: Record<string, unknown>;
  normalized?: Record<string, unknown>;
  prompt?: string;
  failed?: boolean;
  imageUrl?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  isMultiStep?: boolean;
  plan?: unknown;
} | null;

/**
 * Build contextual prompt for agent
 * @param input - Normalized input from webhook
 * @param chatId - Chat ID for context
 * @returns Contextual prompt
 */
export async function buildContextualPrompt(input: NormalizedInput, chatId: string): Promise<string> {
  const userText = input.userText || '';

  const lastCommandRaw = await conversationManager.getLastCommand(chatId);
  let parsedLastCommand: LastCommandSummary = null;
  if (lastCommandRaw) {
    const raw = lastCommandRaw as Record<string, any>;
    parsedLastCommand = {
      tool: raw.tool,
      args: raw.toolArgs || raw.args,
      normalized: raw.normalized,
      prompt: raw.prompt,
      failed: raw.failed,
      imageUrl: raw.imageUrl,
      videoUrl: raw.videoUrl,
      audioUrl: raw.audioUrl,
      isMultiStep: raw.isMultiStep,
      plan: raw.plan
    };
  }

  let contextualPrompt = buildMediaContext(input, userText);

  const authContext = buildAuthContext(input);
  if (authContext) {
    contextualPrompt += `\n\n[הרשאות: ${authContext}]`;
  }

  if (parsedLastCommand) {
    const summary = summarizeLastCommand(parsedLastCommand);
    if (summary) {
      contextualPrompt += `\n\n[פקודה קודמת]: ${summary}`;
    }
  }

  return contextualPrompt;
}

function buildMediaContext(input: NormalizedInput, userText: string): string {
  if (input.quotedContext) {
    return buildQuotedMessageContext(input, userText);
  }

  if (input.hasImage) {
    return buildImageContext(input, userText);
  }
  if (input.hasVideo) {
    return buildVideoContext(input, userText);
  }
  if (input.hasAudio) {
    return buildAudioContext(input, userText);
  }

  return userText;
}

function buildQuotedMessageContext(input: NormalizedInput, userText: string): string {
  const quoted = input.quotedContext;
  if (!quoted) {
    return userText;
  }

  if (quoted.hasImage && quoted.imageUrl) {
    return `[הודעה מצוטטת: תמונה - image_url: ${quoted.imageUrl}]\n${quoted.text || '(תמונה)'}\n\n[בקשה נוכחית:]\n${userText}\n\n**IMPORTANT: User quoted an image with image_url provided above. Based on the request:\n- For analysis/questions (מה זה, תאר, explain, analyze, describe, what is): use analyze_image with image_url: "${quoted.imageUrl}"\n- For edits (ערוך, שנה, הסר, הוסף, edit, change, remove, add): use edit_image with image_url: "${quoted.imageUrl}"\n- DO NOT use retry_last_command unless user explicitly said "נסה שוב" or "שוב"**`;
  }
  if (quoted.hasImage) {
    return `[הודעה מצוטטת: תמונה]\n${quoted.text || '(תמונה)'}\n\n[בקשה נוכחית:]\n${userText}`;
  }

  if (quoted.hasVideo && quoted.videoUrl) {
    return `[הודעה מצוטטת: וידאו - video_url: ${quoted.videoUrl}]\n${quoted.text || '(וידאו)'}\n\n[בקשה נוכחית:]\n${userText}\n\n**IMPORTANT: User quoted a video with video_url provided above. Use analyze_video with video_url: "${quoted.videoUrl}" and question parameter from the current request.**`;
  }
  if (quoted.hasVideo) {
    return `[הודעה מצוטטת: וידאו]\n${quoted.text || '(וידאו)'}\n\n[בקשה נוכחית:]\n${userText}`;
  }

  if (quoted.hasAudio && quoted.audioUrl) {
    return `[הודעה מצוטטת: הקלטה קולית - audio_url: ${quoted.audioUrl || 'לא זמין'}]\n${quoted.text || '(הקלטה)'}\n\n[בקשה נוכחית:]\n${userText}\n\n**IMPORTANT: User quoted audio. Use transcribe_audio with audio_url: "${quoted.audioUrl}" if available.**`;
  }

  return `[הודעה מצוטטת: ${quoted.type}]\n${quoted.text || ''}\n\n[בקשה נוכחית:]\n${userText}`;
}

function buildImageContext(input: NormalizedInput, userText: string): string {
  if (input.imageUrl) {
    return `${userText}\n\n**IMPORTANT: User attached an image. Based on the request:\n- For analysis/questions (מה זה, תאר, explain, analyze, describe): use analyze_image with image_url: "${input.imageUrl}"\n- For edits/generation with image (ערוך, שנה, הסר, הוסף, edit, change): use edit_image with image_url: "${input.imageUrl}"**`;
  }
  return `[המשתמש שלח תמונה] ${userText}`;
}

function buildVideoContext(input: NormalizedInput, userText: string): string {
  if (input.videoUrl) {
    return `${userText}\n\n**IMPORTANT: User attached a video. Use analyze_video with video_url: "${input.videoUrl}" and extract the question from the user's text above.**`;
  }
  return `[המשתמש שלח וידאו] ${userText}`;
}

function buildAudioContext(input: NormalizedInput, userText: string): string {
  if (input.audioUrl) {
    return `${userText}\n\n**IMPORTANT: User attached audio. Use transcribe_audio with audio_url: "${input.audioUrl}" to transcribe it first.**`;
  }
  return `[המשתמש שלח הקלטה קולית] ${userText}`;
}

function buildAuthContext(input: NormalizedInput): string | null {
  const authContext: string[] = [];
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

