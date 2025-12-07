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
    description: 'Send a random location in a specific region (city/country/continent) or completely random. Uses Google Maps geocoding. CRITICAL: Use for ALL location requests. Do NOT use search_google_drive!',
    parameters: {
      type: 'object',
      properties: {
        region: {
          type: 'string',
          description: `The specific place name. Extract EXACT location. Ignore prepositions.
   - "Send location in Tokyo" -> "Tokyo"
   - "מיקום ברחובות" -> "Rehovot"
   - "Send location" -> null (Random)
   Translate Hebrew names to English if possible.`
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
        await greenApiService.sendTextMessage(chatId, regionAckMessage, quotedMessageIdForAck, 1000).catch(err => {
          logger.warn('⚠️ Failed to send location ACK', { error: err.message, chatId });
        });
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
          await greenApiService.sendTextMessage(chatId, `❌ ${errorMessage}`, quotedMessageIdForFailure, 1000).catch(err => {
            logger.warn('⚠️ Failed to send location failure message', { error: err.message, chatId });
          });
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

      // 🚀 Send the actual location message to the user!
      if (chatId) {
        await greenApiService.sendLocation(chatId, latitude, longitude, locationResult.description || '').catch(err => {
          // If main send fails, rethrow to trigger error handler
          throw err;
        });
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
        // CRITICAL FIX: Catch error here to prevent crashing the agent loop
        await greenApiService.sendTextMessage(chatId, `❌ ${errorMessage}`, quotedMessageIdForError, 1000).catch(sendErr => {
          logger.error('❌ Failed to send error message to user - preventing crash', { error: sendErr.message });
        });
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

