/**
 * Group Tools - WhatsApp group creation
 * Clean, modular tool definitions following SOLID principles
 */

import fs from 'fs';
import path from 'path';
import { extractQuotedMessageId } from '../../../utils/messageHelpers';
import { defaultSenderName } from '../../../config/messages';
import { parseGroupCreationPrompt, resolveParticipants } from '../../groupService';
import { createGroup, setGroupPicture, sendTextMessage } from '../../greenApiService';
import { generateImageForWhatsApp } from '../../geminiService';

type CreateGroupArgs = {
  group_name?: string;
  participants_description?: string;
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
    description: 'צור קבוצת WhatsApp חדשה עם משתתפים. זמין רק למשתמשים מורשים.',
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
        }
      },
      required: ['group_name']
    }
  },
  execute: async (args: CreateGroupArgs = {}, context: ToolContext = {}): ToolResult => {
    console.log(`🔧 [Agent Tool] create_group called`);

    try {
      const chatId = context.chatId;
      if (!chatId) {
        return {
          success: false,
          error: 'לא נמצא chatId עבור יצירת הקבוצה'
        };
      }

      const quotedMessageId = extractQuotedMessageId({ context });
      const senderData = context.originalInput?.senderData ?? {};
      const senderId = senderData.senderId || senderData.sender || '';
      const senderName =
        senderData.senderName || senderData.senderContactName || senderId || defaultSenderName;

      const rawPrompt = (context.originalInput?.userText || args.group_name || '')
        .replace(/^#\s*/, '')
        .trim();
      const promptForParsing = rawPrompt || args.participants_description || args.group_name || '';

      console.log(`📋 Parsing group creation request from: "${promptForParsing}"`);

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
            error: 'לא נמצאו משתתפים תואמים ליצירת הקבוצה'
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
          error: 'לא נמצאו משתתפים נוספים ליצירת הקבוצה'
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
            const imagePath = path.join(__dirname, '..', '..', '..', 'public', 'tmp', imageResult.fileName);

            if (fs.existsSync(imagePath)) {
              const imageBuffer = fs.readFileSync(imagePath);
              await sendTextMessage(chatId, '🖼️ מעלה תמונה לקבוצה...', quotedMessageId, 1000);
              await setGroupPicture(groupResult.chatId, imageBuffer);
              await sendTextMessage(chatId, '✅ תמונת הקבוצה עודכנה בהצלחה!', quotedMessageId, 1000);
            } else {
              console.warn(`⚠️ Generated group image not found at ${imagePath}`);
              await sendTextMessage(chatId, '⚠️ התמונה נוצרה אבל לא נמצאה בשרת', quotedMessageId, 1000);
            }
          } else if (imageResult.error) {
            console.error('❌ Image generation failed:', imageResult.error);
            await sendTextMessage(
              chatId,
              `⚠️ הקבוצה נוצרה, אבל הייתה בעיה ביצירת התמונה: ${imageResult.error}`,
              quotedMessageId,
              1000
            );
          }
        } catch (pictureError) {
          const err = pictureError as Error;
          console.error('❌ Failed to set group picture:', err);
          await sendTextMessage(
            chatId,
            `⚠️ הקבוצה נוצרה, אבל לא הצלחתי להעלות תמונה: ${err.message}`,
            quotedMessageId,
            1000
          );
        }
      }

      const summaryLines = [
        `✅ הקבוצה "${parsed.groupName}" מוכנה!`,
        `👤 יוצר: ${senderName}`,
        `👥 משתתפים: ${resolution.resolved.length}`,
        groupResult.chatId ? `🆔 מזהה קבוצה: ${groupResult.chatId}` : null,
        groupResult.groupInviteLink ? `🔗 לינק הזמנה: ${groupResult.groupInviteLink}` : null
      ].filter(Boolean) as string[];

      return {
        success: true,
        data: summaryLines.join('\n'),
        groupId: groupResult.chatId || null,
        groupInviteLink: groupResult.groupInviteLink || null,
        participantsAdded: resolution.resolved.length,
        suppressFinalResponse: true
      };
    } catch (error) {
      const err = error as Error;
      console.error('❌ Error in create_group:', err);
      return {
        success: false,
        error: `שגיאה: ${err.message || 'אירעה שגיאה בלתי צפויה'}`
      };
    }
  }
};

module.exports = {
  create_group
};

