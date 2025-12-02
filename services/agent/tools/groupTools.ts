/**
 * Group Tools - WhatsApp group creation
 * Clean, modular tool definitions following SOLID principles
 */

import fs from 'fs';
import { extractQuotedMessageId } from '../../../utils/messageHelpers';
import { NOT_FOUND, ERROR } from '../../../config/messages';
import { parseGroupCreationPrompt, resolveParticipants } from '../../groupService';
import { createGroup, setGroupPicture, sendTextMessage, getGroupInviteLink } from '../../greenApiService';
import { generateImageForWhatsApp } from '../../geminiService';
import { createTempFilePath } from '../../../utils/tempFileUtils';
import logger from '../../../utils/logger';

type CreateGroupArgs = {
  group_name?: string;
  participants_description?: string;
  group_picture_description?: string;
};

type SenderData = {
  senderId?: string;
  sender?: string;
  senderName?: string;
  senderContactName?: string;
};

type ToolContext = {
  chatId?: string;
  originalInput?: {
    userText?: string;
    originalMessageId?: string;
    senderData?: SenderData;
  };
  normalized?: {
    text?: string;
  };
};

type ToolResult = Promise<{
  success: boolean;
  data?: string;
  groupId?: string | null;
  groupInviteLink?: string | null;
  participantsAdded?: number;
  suppressFinalResponse?: boolean;
  error?: string;
}>;

type GroupCreationResult = {
  groupName: string;
  participants: string[];
  groupPicture?: string;
};

type ParticipantResolution = {
  resolved: Array<{
    searchName: string;
    contactId: string;
    contactName: string;
  }>;
  notFound: string[];
};

type GroupCreationResponse = {
  chatId?: string;
  groupInviteLink?: string;
  [key: string]: unknown;
};

type ImageGenerationResult = {
  success?: boolean;
  fileName?: string;
  error?: string;
};

/**
 * Tool: Create Group
 */
export const create_group = {
  declaration: {
    name: 'create_group',
    description: 'צור קבוצת WhatsApp חדשה עם משתתפים. ניתן גם להגדיר תמונת קבוצה אם היא מתוארת בבקשה (למשל "עם תמונה של..."). זמין רק למשתמשים מורשים. חשוב: אל תשתמש ב-create_image עבור תמונת הקבוצה - כלי זה מטפל בזה באופן פנימי.',
    parameters: {
      type: 'object',
      properties: {
        group_name: {
          type: 'string',
          description: 'שם הקבוצה'
        },
        participants_description: {
          type: 'string',
          description: 'תיאור המשתתפים (למשל: "כל חברי המשפחה", "צוות העבודה", וכו\')'
        },
        group_picture_description: {
          type: 'string',
          description: 'תיאור תמונת הקבוצה (אופציונלי). השתמש בזה אם המשתמש ביקש תמונה ספציפית לקבוצה.'
        }
      },
      required: ['group_name']
    }
  },
  execute: async (args: CreateGroupArgs = {}, context: ToolContext = {}): ToolResult => {
    logger.info(`🔧 [Agent Tool] create_group called`);

    try {
      const chatId = context.chatId;
      if (!chatId) {
        return {
          success: false,
          error: NOT_FOUND.CHAT_ID_FOR_GROUP
        };
      }

      const quotedMessageId = extractQuotedMessageId({ context });
      const senderData = context.originalInput?.senderData ?? {};
      const senderId = senderData.senderId || senderData.sender || '';

      const rawPrompt = (context.originalInput?.userText || '')
        .replace(/^#\s*/, '')
        .trim();

      let promptForParsing = rawPrompt;

      // If no original text, construct prompt from arguments
      if (!promptForParsing) {
        const parts = [];
        if (args.group_name) parts.push(`Create group "${args.group_name}"`);
        if (args.participants_description) parts.push(`with participants: ${args.participants_description}`);
        if (args.group_picture_description) parts.push(`with picture of: ${args.group_picture_description}`);

        if (parts.length > 0) {
          promptForParsing = parts.join(' ');
        } else {
          promptForParsing = '';
        }
      }

      if (!promptForParsing.trim()) {
        return {
          success: false,
          error: 'נא לספק שם לקבוצה או תיאור משתתפים.'
        };
      }

      logger.info(`📋 Parsing group creation request from: "${promptForParsing}"`);

      await sendTextMessage(chatId, '👥 מתחיל יצירת קבוצה...', quotedMessageId, 1000);
      await sendTextMessage(chatId, '🔍 מנתח את הבקשה...', quotedMessageId, 1000);

      const parsed = (await parseGroupCreationPrompt(promptForParsing)) as GroupCreationResult;

      let statusMsg = `📋 שם הקבוצה: "${parsed.groupName}"\n👥 מחפש ${parsed.participants.length} משתתפים...`;
      if (parsed.groupPicture) {
        statusMsg += `\n🎨 תמונה: ${parsed.groupPicture}`;
      }
      await sendTextMessage(chatId, statusMsg, quotedMessageId, 1000);

      const resolution = (await resolveParticipants(parsed.participants)) as ParticipantResolution;

      if (resolution.notFound.length > 0) {
        let errorMsg = '⚠️ לא מצאתי את המשתתפים הבאים:\n';
        resolution.notFound.forEach(name => {
          errorMsg += `• ${name}\n`;
        });
        errorMsg += '\n💡 טיפ: וודא שהשמות נכונים או הרץ "עדכן אנשי קשר" לסנכרון אנשי קשר';

        if (resolution.resolved.length === 0) {
          await sendTextMessage(
            chatId,
            `${errorMsg}\n\n❌ לא נמצאו משתתפים - ביטול יצירת קבוצה`,
            quotedMessageId,
            1000
          );
          return {
            success: false,
            error: NOT_FOUND.PARTICIPANTS
          };
        }

        await sendTextMessage(chatId, errorMsg, quotedMessageId, 1000);
      }

      if (resolution.resolved.length > 0) {
        let foundMsg = `✅ נמצאו ${resolution.resolved.length} משתתפים:\n`;
        resolution.resolved.forEach(participant => {
          foundMsg += `• ${participant.searchName} → ${participant.contactName}\n`;
        });
        await sendTextMessage(chatId, foundMsg, quotedMessageId, 1000);
      }

      await sendTextMessage(chatId, '🔨 יוצר את הקבוצה...', quotedMessageId, 1000);

      const participantIds = resolution.resolved
        .map(participant => participant.contactId)
        .filter((id): id is string => Boolean(id && id !== senderId));

      if (participantIds.length === 0) {
        await sendTextMessage(
          chatId,
          '⚠️ לא נמצאו משתתפים נוספים (חוץ ממך). צריך לפחות משתתף אחד נוסף ליצירת קבוצה.',
          quotedMessageId,
          1000
        );
        return {
          success: false,
          error: NOT_FOUND.ADDITIONAL_PARTICIPANTS
        };
      }

      const groupResult = (await createGroup(
        parsed.groupName,
        participantIds
      )) as GroupCreationResponse;
      await sendTextMessage(chatId, `✅ הקבוצה "${parsed.groupName}" נוצרה בהצלחה!`, quotedMessageId, 1000);

      if (parsed.groupPicture && groupResult.chatId) {
        try {
          await sendTextMessage(
            chatId,
            `🎨 יוצר תמונת פרופיל לקבוצה...\n"${parsed.groupPicture}"`,
            quotedMessageId,
            1000
          );

          const imageResult = (await generateImageForWhatsApp(
            parsed.groupPicture
          )) as ImageGenerationResult;

          if (imageResult.success && imageResult.fileName) {
            // Use createTempFilePath for consistent path resolution (uses config.paths.tmp)
            const imagePath = createTempFilePath(imageResult.fileName);

            if (fs.existsSync(imagePath)) {
              const imageBuffer = fs.readFileSync(imagePath);
              await sendTextMessage(chatId, '🖼️ מעלה תמונה לקבוצה...', quotedMessageId, 1000);
              await setGroupPicture(groupResult.chatId, imageBuffer);
              await sendTextMessage(chatId, '✅ תמונת הקבוצה עודכנה בהצלחה!', quotedMessageId, 1000);
            } else {
              logger.warn(`⚠️ Generated group image not found at ${imagePath}`);
              await sendTextMessage(chatId, '⚠️ התמונה נוצרה אבל לא נמצאה בשרת', quotedMessageId, 1000);
            }
          } else if (imageResult.error) {
            logger.error('❌ Image generation failed:', imageResult.error);
            await sendTextMessage(
              chatId,
              `⚠️ הקבוצה נוצרה, אבל הייתה בעיה ביצירת התמונה: ${imageResult.error}`,
              quotedMessageId,
              1000
            );
          }
        } catch (pictureError) {
          const err = pictureError as Error;
          logger.error('❌ Failed to set group picture:', err);
          await sendTextMessage(
            chatId,
            `⚠️ הקבוצה נוצרה, אבל לא הצלחתי להעלות תמונה: ${err.message}`,
            quotedMessageId,
            1000
          );
        }
      }

      let inviteLink = groupResult.groupInviteLink;
      if (!inviteLink && groupResult.chatId) {
        try {
          inviteLink = await getGroupInviteLink(groupResult.chatId) || undefined;
        } catch (err) {
          logger.warn('⚠️ Failed to fetch invite link', { error: err });
        }
      }

      const summaryLines = [
        `✅ הקבוצה "${parsed.groupName}" מוכנה!`,
        `👥 משתתפים: ${resolution.resolved.length + 1}`, // +1 for the creator
        parsed.groupPicture ? `🎨 תמונת קבוצה: נוצרה ועודכנה` : null
      ].filter(Boolean) as string[];

      return {
        success: true,
        data: summaryLines.join('\n'),
        groupId: groupResult.chatId || null,
        groupInviteLink: inviteLink || null,
        participantsAdded: resolution.resolved.length,
        suppressFinalResponse: true
      };
    } catch (error) {
      const err = error as Error;
      logger.error('❌ Error in create_group:', err);
      return {
        success: false,
        error: ERROR.generic(err.message || ERROR.unexpected)
      };
    }
  }
};

// ES6 exports only - CommonJS not needed in TypeScript
export default { create_group };
