/**
 * Green API constants
 */

const GREEN_API_ID_INSTANCE = process.env.GREEN_API_ID_INSTANCE || 'your_instance_id';
const GREEN_API_API_TOKEN_INSTANCE = process.env.GREEN_API_API_TOKEN_INSTANCE || 'your_api_token';

const BASE_URL = `https://api.green-api.com/waInstance${GREEN_API_ID_INSTANCE}`;

module.exports = {
  GREEN_API_ID_INSTANCE,
  GREEN_API_API_TOKEN_INSTANCE,
  BASE_URL
};

