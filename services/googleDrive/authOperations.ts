import { google } from 'googleapis';

/**
 * Google Drive Authentication Operations
 *
 * Supports two modes:
 * 1) Service Account (server-to-server, preferred for this project)
 * 2) OAuth2 (user-based) as a fallback
 */

/**
 * Get Google Drive client using Service Account (preferred for server-to-server)
 * Uses environment variables:
 * - GOOGLE_DRIVE_SA_CLIENT_EMAIL
 * - GOOGLE_DRIVE_SA_PRIVATE_KEY
 */
export function getServiceAccountDriveClient() {
  const clientEmail = process.env.GOOGLE_DRIVE_SA_CLIENT_EMAIL;
  const privateKeyEnv = process.env.GOOGLE_DRIVE_SA_PRIVATE_KEY;

  if (!clientEmail || !privateKeyEnv) {
    return null;
  }

  // Support "\n" in env variable
  const privateKey = privateKeyEnv.replace(/\\n/g, '\n');

  const jwtClient = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });

  return google.drive({ version: 'v3', auth: jwtClient });
}

/**
 * Get authenticated Drive client
 */
export function getAuthenticatedDriveClient() {
  const serviceAccountClient = getServiceAccountDriveClient();
  if (!serviceAccountClient) {
    throw new Error(
      'Google Drive service account is not configured. Please set GOOGLE_DRIVE_SA_CLIENT_EMAIL and GOOGLE_DRIVE_SA_PRIVATE_KEY.'
    );
  }
  return serviceAccountClient;
}

