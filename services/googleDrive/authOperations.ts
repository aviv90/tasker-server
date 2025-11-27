/**
 * Google Drive Authentication Operations
 * 
 * Handles OAuth 2.0 authentication flow for Google Drive API access.
 */

import { google } from 'googleapis';

/**
 * OAuth2 Client Configuration
 */
interface OAuth2Config {
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;
  refreshToken?: string;
  accessToken?: string;
}

/**
 * Get OAuth2 client for Google Drive
 */
export function getOAuth2Client(configOverride?: Partial<OAuth2Config>) {
  const clientId = configOverride?.clientId || process.env.GOOGLE_DRIVE_CLIENT_ID || '';
  const clientSecret = configOverride?.clientSecret || process.env.GOOGLE_DRIVE_CLIENT_SECRET || '';
  const redirectUri = configOverride?.redirectUri || process.env.GOOGLE_DRIVE_REDIRECT_URI || 'http://localhost:3000/oauth2callback';

  if (!clientId) {
    throw new Error('GOOGLE_DRIVE_CLIENT_ID is required');
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );

  // Set credentials if available
  const refreshToken = configOverride?.refreshToken || process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  const accessToken = configOverride?.accessToken || process.env.GOOGLE_DRIVE_ACCESS_TOKEN;

  if (refreshToken) {
    oauth2Client.setCredentials({
      refresh_token: refreshToken,
      access_token: accessToken
    });
  }

  return oauth2Client;
}

/**
 * Generate OAuth2 authorization URL
 */
export function getAuthUrl(scopes: string[] = ['https://www.googleapis.com/auth/drive.readonly']): string {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });
}

/**
 * Exchange authorization code for tokens
 */
export async function getTokensFromCode(code: string): Promise<{
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
}> {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await oauth2Client.refreshAccessToken();
  
  if (!credentials.access_token) {
    throw new Error('Failed to refresh access token');
  }
  
  return credentials.access_token;
}

/**
 * Get authenticated Drive client
 */
export function getAuthenticatedDriveClient() {
  const oauth2Client = getOAuth2Client();
  return google.drive({ version: 'v3', auth: oauth2Client });
}

