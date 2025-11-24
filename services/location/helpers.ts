/**
 * Location service helper functions
 */

/**
 * Load JSON file
 * Handles both development (source) and production (dist) paths
 */
export function loadJson(filePath: string): unknown {
  try {
    // Try relative path first (for development)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(filePath);
  } catch (err: unknown) {
    // In production (dist/), try path relative to project root
    try {
      const path = require('path');
      // If we're in dist/, go up to project root
      const isInDist = __dirname.includes('dist');
      const projectRoot = isInDist 
        ? path.join(__dirname, '..', '..', '..') // dist/services/location -> project root
        : path.join(__dirname, '..', '..'); // services/location -> project root
      const absolutePath = path.join(projectRoot, filePath.replace(/^\.\.\//g, ''));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(absolutePath);
    } catch (err2: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorMessage2 = err2 instanceof Error ? err2.message : String(err2);
      console.warn(`⚠️ Could not load ${filePath}:`, errorMessage, errorMessage2);
      return null;
    }
  }
}

/**
 * Check if location description indicates land (not water)
 */
export function isLandLocation(description: string | null | undefined): boolean {
  if (!description) return false;
  const descLower = description.toLowerCase();

  const landIndicators = [
    'עיר', 'כפר', 'ישוב', 'מדינה', 'רחוב', 'שכונה', 'אזור', 'מחוז', 'מדבר', 'הר', 'עמק', 'יער',
    'city', 'town', 'village', 'country', 'street', 'district', 'region', 'province',
    'desert', 'mountain', 'valley', 'forest', 'park', 'road', 'highway', 'building',
    'neighborhood', 'settlement', 'capital', 'state', 'county', 'rural', 'urban', 'population'
  ];

  if (landIndicators.some(indicator => descLower.includes(indicator))) {
    return true;
  }

  const openWaterKeywords = [
    'אוקיינוס', 'באוקיינוס', 'באמצע האוקיינוס', 'באמצע הים', 'בלב הים',
    'in the ocean', 'in the middle of the ocean', 'in the middle of the sea',
    'open water', 'open ocean', 'deep water', 'deep ocean', 'open sea',
    'atlantic ocean', 'pacific ocean', 'indian ocean', 'arctic ocean',
    'מים פתוחים', 'מים עמוקים', 'אין יבשה', 'no land'
  ];

  return !openWaterKeywords.some(keyword => descLower.includes(keyword));
}

/**
 * Requested region structure
 */
export interface RequestedRegion {
  displayName?: string;
  [key: string]: unknown;
}

/**
 * Build acknowledgment message for location request
 */
export function buildLocationAckMessage(requestedRegion: RequestedRegion | null | undefined): string {
  if (requestedRegion && requestedRegion.displayName) {
    return `🌍 שולח מיקום באזור ${requestedRegion.displayName}...`;
  }
  return '🌍 שולח מיקום אקראי...';
}

