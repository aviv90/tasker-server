/**
 * URL Utilities
 * 
 * Centralized logic for determining server URLs across the application.
 * This ensures consistency between all services and endpoints.
 */

import { Request } from 'express';

/**
 * Get the server's base URL
 * @param req - Express request object (optional)
 * @returns The base URL of the server
 */
export function getServerBaseUrl(req: Request | null = null): string {
  // If we have a request object, use it (most reliable)
  if (req && req.protocol && req.get) {
    const host = req.get('host');
    if (host) {
      return `${req.protocol}://${host}`;
    }
  }

  // Check for explicitly set SERVER_URL
  if (process.env.SERVER_URL) {
    return process.env.SERVER_URL;
  }

  // Check for PUBLIC_URL
  if (process.env.PUBLIC_URL) {
    return process.env.PUBLIC_URL;
  }

  // Development fallback
  return 'http://localhost:3000';
}

/**
 * Get a full URL for a static file
 * @param filename - The filename to serve
 * @param req - Express request object (optional)
 * @returns Full URL to the static file
 */
export function getStaticFileUrl(filename: string, req: Request | null = null): string {
  const baseUrl = getServerBaseUrl(req);
  return `${baseUrl}/static/${filename}`;
}

/**
 * Get a full URL for an API endpoint
 * @param endpoint - The API endpoint path (e.g., '/api/music/callback')
 * @param req - Express request object (optional)
 * @returns Full URL to the API endpoint
 */
export function getApiUrl(endpoint: string, req: Request | null = null): string {
  const baseUrl = getServerBaseUrl(req);
  // Ensure endpoint starts with /
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${baseUrl}${cleanEndpoint}`;
}

/**
 * Normalize a static file URL/path to a full URL
 * Handles both relative paths (with /static/) and full URLs
 * @param urlOrPath - URL or path to normalize
 * @param req - Express request object (optional)
 * @returns Full URL to the static file
 */
export function normalizeStaticFileUrl(urlOrPath: string, req: Request | null = null): string {
  // If already a full URL, return as-is
  if (urlOrPath.startsWith('http')) {
    return urlOrPath;
  }

  // Remove /static/ prefix if present
  const cleanPath = urlOrPath.replace(/^\/static\//, '');

  // Return full static file URL
  return getStaticFileUrl(cleanPath, req);
}

// Backward compatibility: CommonJS export
module.exports = {
  getServerBaseUrl,
  getStaticFileUrl,
  getApiUrl,
  normalizeStaticFileUrl
};

