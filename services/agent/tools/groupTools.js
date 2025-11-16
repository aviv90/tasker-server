/**
 * Group Tools - WhatsApp group creation
 * Clean, modular tool definitions following SOLID principles
 */

/**
 * Tool: Create Group
 */
const create_group = {
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
  execute: async (args, context) => {
    console.log(`🔧 [Agent Tool] create_group called`);
    
    try {
      const chatId = context.chatId;
      if (!chatId) {
        return {
          success: false,
          error: 'לא נמצא chatId עבור יצירת הקבוצה'
        };
      }
      
      const senderData = context.originalInput?.senderData || {};
      const senderId = senderData.senderId || senderData.sender;
      const senderName = senderData.senderName || senderData.senderContactName || senderId || 'המשתמש';
      
      const { parseGroupCreationPrompt, resolveParticipants } = require('../../groupService');
      const { createGroup, setGroupPicture, sendTextMessage } = require('../../greenApiService');
      const { generateImageForWhatsApp } = require('../../geminiService');
      const fs = require('fs');
      const path = require('path');
      
      // Use the original user request to extract group details (falls back to args.group_name)
      const rawPrompt = (context.originalInput?.userText || args.group_name || '').replace(/^#\s*/, '').trim();
      const promptForParsing = rawPrompt || args.participants_description || args.group_name;
      
      console.log(`📋 Parsing group creation request from: "${promptForParsing}"`);
      
      await sendTextMessage(chatId, '👥 מתחיל יצירת קבוצה...');
      await sendTextMessage(chatId, '🔍 מנתח את הבקשה...');
      
      const parsed = await parseGroupCreationPrompt(promptForParsing);
      
      let statusMsg = `📋 שם הקבוצה: "${parsed.groupName}"\n👥 מחפש ${parsed.participants.length} משתתפים...`;
      if (parsed.groupPicture) {
        statusMsg += `\n🎨 תמונה: ${parsed.groupPicture}`;
      }
      await sendTextMessage(chatId, statusMsg);
      
      const resolution = await resolveParticipants(parsed.participants);
      
      if (resolution.notFound.length > 0) {
        let errorMsg = `⚠️ לא מצאתי את המשתתפים הבאים:\n`;
        resolution.notFound.forEach(name => {
          errorMsg += `• ${name}\n`;
        });
        errorMsg += `\n💡 טיפ: וודא שהשמות נכונים או הרץ "עדכן אנשי קשר" לסנכרון אנשי קשר`;
        
        if (resolution.resolved.length === 0) {
          await sendTextMessage(chatId, errorMsg + '\n\n❌ לא נמצאו משתתפים - ביטול יצירת קבוצה');
          return {
            success: false,
            error: 'לא נמצאו משתתפים תואמים ליצירת הקבוצה'
          };
        }
        
        await sendTextMessage(chatId, errorMsg);
      }
      
      if (resolution.resolved.length > 0) {
        let foundMsg = `✅ נמצאו ${resolution.resolved.length} משתתפים:\n`;
        resolution.resolved.forEach(p => {
          foundMsg += `• ${p.searchName} → ${p.contactName}\n`;
        });
        await sendTextMessage(chatId, foundMsg);
      }
      
      await sendTextMessage(chatId, '🔨 יוצר את הקבוצה...');
      
      const participantIds = resolution.resolved
        .map(p => p.contactId)
        .filter(id => id && id !== senderId);
      
      if (participantIds.length === 0) {
        await sendTextMessage(chatId, '⚠️ לא נמצאו משתתפים נוספים (חוץ ממך). צריך לפחות משתתף אחד נוסף ליצירת קבוצה.');
        return {
          success: false,
          error: 'לא נמצאו משתתפים נוספים ליצירת הקבוצה'
        };
      }
      
      const groupResult = await createGroup(parsed.groupName, participantIds);
      await sendTextMessage(chatId, `✅ הקבוצה "${parsed.groupName}" נוצרה בהצלחה!`);
      
      if (parsed.groupPicture && groupResult.chatId) {
        try {
          await sendTextMessage(chatId, `🎨 יוצר תמונת פרופיל לקבוצה...\n"${parsed.groupPicture}"`);
          
          const imageResult = await generateImageForWhatsApp(parsed.groupPicture);
          
          if (imageResult.success && imageResult.fileName) {
            const imagePath = path.join(__dirname, '..', '..', '..', 'public', 'tmp', imageResult.fileName);
            
            if (fs.existsSync(imagePath)) {
              const imageBuffer = fs.readFileSync(imagePath);
              await sendTextMessage(chatId, '🖼️ מעלה תמונה לקבוצה...');
              await setGroupPicture(groupResult.chatId, imageBuffer);
              await sendTextMessage(chatId, '✅ תמונת הקבוצה עודכנה בהצלחה!');
            } else {
              console.warn(`⚠️ Generated group image not found at ${imagePath}`);
            }
          } else if (imageResult.error) {
            await sendTextMessage(chatId, `⚠️ הקבוצה נוצרה, אבל הייתה בעיה ביצירת התמונה: ${imageResult.error}`);
          }
        } catch (pictureError) {
          console.error('❌ Failed to set group picture:', pictureError);
          await sendTextMessage(chatId, `⚠️ הקבוצה נוצרה, אבל לא הצלחתי להעלות תמונה: ${pictureError.message}`);
        }
      }
      
      const summaryLines = [
        `✅ הקבוצה "${parsed.groupName}" מוכנה!`,
        `👤 יוצר: ${senderName}`,
        `👥 משתתפים: ${resolution.resolved.length}`,
        groupResult.chatId ? `🆔 מזהה קבוצה: ${groupResult.chatId}` : null,
        groupResult.groupInviteLink ? `🔗 לינק הזמנה: ${groupResult.groupInviteLink}` : null
      ].filter(Boolean);
      
      return {
        success: true,
        data: '',
        groupId: groupResult.chatId || null,
        groupInviteLink: groupResult.groupInviteLink || null,
        participantsAdded: resolution.resolved.length,
        suppressFinalResponse: true
      };
    } catch (error) {
      console.error('❌ Error in create_group:', error);
      return {
        success: false,
        error: `שגיאה: ${error.message}`
      };
    }
  }
};

module.exports = {
  create_group
};

