/**
 * Group Tools - WhatsApp group creation
 * Clean, modular tool definitions following SOLID principles
 */

import fs from 'fs';
import { extractQuotedMessageId } from '../../../utils/messageHelpers';
import { NOT_FOUND, ERROR } from '../../../config/messages';
import { resolveParticipants } from '../../groupService';
import { createGroup, setGroupPicture, sendTextMessage, getGroupInviteLink } from '../../greenApiService';
import { generateImageForWhatsApp } from '../../geminiService';
import { createTempFilePath } from '../../../utils/tempFileUtils';
import logger from '../../../utils/logger';

// Types
type CreateGroupArgs = {
  group_name: string;
  participants: string[];
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
    description: 'Create a new WhatsApp group with participants. Extract group name and list of participants. If a group picture description is provided, extract it as well.',
    parameters: {
      type: 'object',
      properties: {
        group_name: {
          type: 'string',
          description: 'Name of the group'
        },
        participants: {
          type: 'array',
          items: {
            type: 'string'
          },
          description: 'List of participant names to add (e.g. ["Mom", "Dad", "Yossi"])'
        },
        group_picture_description: {
          type: 'string',
          description: 'Description for the group picture (optional)'
        }
      },
      required: ['group_name', 'participants']
    }
  },
  execute: async (args: CreateGroupArgs, context: ToolContext = {}): ToolResult => {
    logger.info(`🔧 [Agent Tool] create_group called`, { args });

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

      await sendTextMessage(chatId, '👥 מתחיל יצירת קבוצה...', quotedMessageId, 1000);

      const groupName = args.group_name;
      const participants = args.participants || [];
      const groupPicture = args.group_picture_description;

      let statusMsg = `📋 שם הקבוצה: "${groupName}"\n👥 מחפש ${participants.length} משתתפים...`;
      if (groupPicture) {
        statusMsg += `\n🎨 תמונה: ${groupPicture}`;
      }
      await sendTextMessage(chatId, statusMsg, quotedMessageId, 1000);

      const resolution = (await resolveParticipants(participants)) as ParticipantResolution;

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
        groupName,
        participantIds
      )) as GroupCreationResponse;
      await sendTextMessage(chatId, `✅ הקבוצה "${groupName}" נוצרה בהצלחה!`, quotedMessageId, 1000);

      if (groupPicture && groupResult.chatId) {
        try {
          await sendTextMessage(
            chatId,
            `🎨 יוצר תמונת פרופיל לקבוצה...\n"${groupPicture}"`,
            quotedMessageId,
            1000
          );

          const imageResult = (await generateImageForWhatsApp(
            groupPicture
          )) as ImageGenerationResult;

          if (imageResult.success && imageResult.fileName) {
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
        `✅ הקבוצה "${groupName}" מוכנה!`,
        `👥 משתתפים: ${resolution.resolved.length + 1}`, // +1 for the creator
        groupPicture ? `🎨 תמונת קבוצה: נוצרה ועודכנה` : null
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
