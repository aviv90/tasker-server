/**
 * Location extraction from prompts
 */

import { getLocationBounds } from '../geminiService';
// Constants imports removed as we now rely on Geocoding
import logger from '../../utils/logger';

/**
 * Extracted region information
 */
export interface ExtractedRegion {
  continentName?: string | null;
  displayName: string;
  bounds?: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
    foundName?: string;
    type?: string;
  } | null;
  isCity?: boolean;
  multiRegions?: string[] | null;
  [key: string]: unknown; // Allow additional properties
}

type BoundsResult = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  foundName?: string;
  type?: string;
};

/**
 * Extract requested region/city from prompt
 */
export async function extractRequestedRegion(prompt: string | null | undefined): Promise<ExtractedRegion | null> {
  if (!prompt || typeof prompt !== 'string') return null;

  logger.info(`🔍 extractRequestedRegion called with: "${prompt}"`);

  // 1. Check if it's a known continent/region (for random generation in that area)
  // We check the 'continents' array from constants via a helper or direct check?
  // Since we are decoupling, let's just use the geocoder first.
  // Actually, 'findRandomLocation' logic often relies on 'continentName' to pick a random point in a box.
  // Geocoding "Europe" returns a viewport/bounds. We can use that!

  // 2. Direct Geocoding (The core of the optimization)
  logger.info(`🌍 Attempting to geocode region: "${prompt}"`);
  try {
    const bounds = (await getLocationBounds(prompt)) as BoundsResult | null;
    if (bounds) {
      logger.info(`✅ Found bounds for "${prompt}" via geocoding`);

      // Determine if it's a "continent" or "country" based on type or just return bounds
      // The previous logic had specific "continent" handling.
      // If we return 'bounds', findRandomLocation should handle it.
      return {
        continentName: null, // We let the bounds dictate the area
        displayName: (bounds.foundName as string) || prompt,
        bounds: bounds,
        isCity: ((bounds.type as string) || '').toLowerCase().includes('city')
      };
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.warn(`⚠️ Error geocoding "${prompt}": ${errorMessage}`);
  }

  // 3. Fallback: If geocoding failed, maybe it's a broad region name that our legacy 'continents' list handled better?
  // For now, let's assume Geocoder is superior.

  logger.warn(`❌ No region/city found via geocoding for: "${prompt}"`);
  return null;
}
