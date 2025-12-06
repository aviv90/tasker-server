/**
 * Location Tools - Random location generation
 */

import { getServices } from '../utils/serviceLoader';
import {
  extractRequestedRegion,
  buildLocationAckMessage,
  findRandomLocation
} from '../../locationService';
import { extractQuotedMessageId } from '../../../utils/messageHelpers';
import logger from '../../../utils/logger';

type SendLocationArgs = {
  region?: string;
};

type ToolContext = {
  chatId?: string;
  originalInput?: { userText?: string; language?: string; originalMessageId?: string };
  normalized?: { text?: string; language?: string };
};

type ToolResult = Promise<{
  success: boolean;
  latitude?: number;
  longitude?: number;
  locationInfo?: string;
  data?: string;
  suppressFinalResponse?: boolean;
  error?: string;
}>;

export const send_location = {
  declaration: {
    name: 'send_location',
    description:
      'שלח מיקום אקראי במקום מסוים (עיר/מדינה/יבשת) או מיקום אקראי לגמרי. משתמש ב-Google Maps geocoding למציאת כל מקום בעולם. **CRITICAL: Use this tool for ALL location requests. Do NOT use search_google_drive or other tools for location requests!**',
    parameters: {
      type: 'object',
      properties: {
        region: {
          type: 'string',
          description: `The specific place name to find a location in.
**CRITICAL INSTRUCTION:**
1. Extract the EXACT location name from the user's request.
2. Ignore preposition words like "in", "at", "near", "area of", "ב", "באזור".
3. Return ONLY the name.
   - User: "Send location in Tokyo" -> region="Tokyo"
   - User: "מיקום ברחובות" -> region="Rehovot"
   - User: "באזור תל אביב" -> region="Tel Aviv"
   - User: "Send location" -> region=null (Random)
   - User: "Copenhagen" -> region="Copenhagen"
   
You must translate Hebrew names to English or keep them in Hebrew, but English is preferred for geocoding accuracy.`
        }
      },
      required: []
    }
  },
  execute: async (args: SendLocationArgs, context: ToolContext = {}): ToolResult => {
    logger.debug(`🔧 [Agent Tool] send_location called with region: ${args.region || 'none'}`);
    const { greenApiService } = getServices();
    const chatId = context?.chatId;

    try {
      const userText = context?.originalInput?.userText || context?.normalized?.text || '';
      const regionParam = args.region || '';

      const regionToSearch = regionParam ? regionParam : userText;

      logger.debug(`📍 [Location] Searching for region: "${regionToSearch}"`);
      const requestedRegion = await extractRequestedRegion(regionToSearch);
      const regionAckMessage = buildLocationAckMessage(requestedRegion);

      if (regionAckMessage && chatId) {
        const quotedMessageIdForAck = extractQuotedMessageId({ context });
        await greenApiService.sendTextMessage(chatId, regionAckMessage, quotedMessageIdForAck, 1000);
      }

      const language = context?.originalInput?.language || context?.normalized?.language || 'he';
      logger.debug(`🌐 [Location] Using language: ${language}`);

      const locationResult = await findRandomLocation({ requestedRegion, language });
      if (!locationResult.success) {
        const errorMessage =
          locationResult.error ||
          (language === 'he' ? 'לא הצלחתי למצוא מיקום תקין' : 'Could not find a valid location');
        if (chatId) {
          const quotedMessageIdForFailure = extractQuotedMessageId({ context });
          await greenApiService.sendTextMessage(chatId, `❌ ${errorMessage}`, quotedMessageIdForFailure, 1000);
        }
        return {
          success: false,
          error: errorMessage
        };
      }

      const latitude = parseFloat(String(locationResult.latitude ?? ''));
      const longitude = parseFloat(String(locationResult.longitude ?? ''));

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
      const err = error as Error;
      logger.error('❌ Error in send_location:', { error: err.message, stack: err.stack });
      const errorMessage = err.message || 'שגיאה לא ידועה בשליחת המיקום';
      if (chatId) {
        const quotedMessageIdForError = extractQuotedMessageId({ context });
        await greenApiService.sendTextMessage(chatId, `❌ ${errorMessage}`, quotedMessageIdForError, 1000);
      }
      return {
        success: false,
        error: errorMessage
      };
    }
  }
};

// ES6 exports only - CommonJS not needed in TypeScript
export default { send_location };

