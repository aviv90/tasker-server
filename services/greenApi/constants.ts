/**
 * Green API constants
 */

import config from '../../config/env';

export const GREEN_API_ID_INSTANCE = config.whatsapp.instanceId;
export const GREEN_API_API_TOKEN_INSTANCE = config.whatsapp.apiToken;

export const BASE_URL = `https://api.green-api.com/waInstance${GREEN_API_ID_INSTANCE}`;
