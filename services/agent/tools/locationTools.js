/**
 * Location Tools - Random location generation
 * Clean, modular tool definitions following SOLID principles
 */

const { getServices } = require('../utils/serviceLoader');
const locationService = require('../../locationService');

/**
 * Tool: Send Location
 */
const send_location = {
  declaration: {
    name: 'send_location',
    description: 'שלח מיקום אקראי במקום מסוים (עיר/מדינה/יבשת) או מיקום אקראי לגמרי. משתמש ב-Google Maps geocoding למציאת כל מקום בעולם.',
    parameters: {
      type: 'object',
      properties: {
        region: {
          type: 'string',
          description: `שם המקום המדויק שהמשתמש ביקש - **אופציונלי!** ציין רק אם המשתמש ביקש אזור ספציפי.
          
**CRITICAL - Region is OPTIONAL:**
- "שלח מיקום" (ללא אזור) → אל תציין region (מיקום אקראי)
- "שלח מיקום אקראי" → אל תציין region
- "שלח מיקום באזור תל אביב" → region="תל אביב" (ציין!)
- "מיקום ברחובות" → region="רחובות" (ציין!)

דוגמאות:
- "שלח מיקום באזור תל אביב" → region="תל אביב" (לא "באזור תל אביב"!)
- "מיקום ברחובות" → region="רחובות"
- "send location in Tokyo" → region="Tokyo"
- "מיקום במדבר יהודה" → region="מדבר יהודה"
- "באזור לונדון" → region="London"
- "מיקום בצרפת" → region="צרפת"
- "ביפן" → region="יפן"
- "באירופה" → region="אירופה"
- "שלח מיקום" / "שלח מיקום אקראי" → אל תציין region (השאר ריק או null)

כללים חשובים:
1. העתק רק את שם המקום עצמו, בלי מילות קישור ("באזור", "ב", "in", "near")
2. שמור על האיות המקורי (עברית/אנגלית כמו שהמשתמש כתב)
3. **אם אין אזור ספציפי בבקשה - אל תציין region!** (מיקום אקראי אוטומטית)
4. גם כפרים/יישובים/שכונות קטנים - ציין ב-region אם המשתמש ביקש!`
        }
      },
      required: []
    }
  },
  execute: async (args, context) => {
    console.log(`🔧 [Agent Tool] send_location called with region: ${args.region || 'none'}`);
    const { greenApiService } = getServices();

    try {
      // Build a comprehensive search string from all available sources
      const userText = context?.originalInput?.userText || context?.normalized?.text || '';
      const regionParam = args.region || '';
      
      // Combine region parameter with user text for better matching
      const regionToSearch = regionParam ? regionParam : userText;
      
      console.log(`📍 [Location] Searching for region: "${regionToSearch}"`);
      const requestedRegion = await locationService.extractRequestedRegion(regionToSearch);
      const regionAckMessage = locationService.buildLocationAckMessage(requestedRegion);

      if (regionAckMessage && context?.chatId) {
        const quotedMessageId = context.originalInput?.originalMessageId || null;
        await greenApiService.sendTextMessage(context.chatId, regionAckMessage, quotedMessageId);
      }

      const locationResult = await locationService.findRandomLocation({ requestedRegion });
      if (!locationResult.success) {
        const errorMessage = locationResult.error || 'לא הצלחתי למצוא מיקום תקין';
        if (context?.chatId) {
          const quotedMessageId = context.originalInput?.originalMessageId || null;
          await greenApiService.sendTextMessage(context.chatId, `❌ ${errorMessage}`, quotedMessageId);
        }
        return {
          success: false,
          error: errorMessage
        };
      }

      const latitude = parseFloat(locationResult.latitude);
      const longitude = parseFloat(locationResult.longitude);

      if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
        throw new Error('Invalid coordinates returned from location service');
      }

      return {
        success: true,
        latitude,
        longitude,
        locationInfo: locationResult.description || '',
        data: locationResult.description || '',
        suppressFinalResponse: true
      };
    } catch (error) {
      console.error('❌ Error in send_location:', error);
      const errorMessage = error?.message || 'שגיאה לא ידועה בשליחת המיקום';
      if (context?.chatId) {
        const quotedMessageId = context.originalInput?.originalMessageId || null;
        await greenApiService.sendTextMessage(context.chatId, `❌ ${errorMessage}`, quotedMessageId);
      }
      return {
        success: false,
        error: errorMessage
      };
    }
  }
};

module.exports = {
  send_location
};

