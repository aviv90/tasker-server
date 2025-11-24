/**
 * Location finder - finds random locations based on requested region
 */

import { continents } from './constants';
import { isLandLocation } from './helpers';
import { extractRequestedRegion, ExtractedRegion } from './extraction';
import { buildLocationAckMessage } from './helpers';

/**
 * Requested region structure (alias for ExtractedRegion)
 */
type RequestedRegion = ExtractedRegion;

/**
 * Location finder parameters
 */
interface FindRandomLocationParams {
  requestedRegion?: RequestedRegion | null;
  maxAttempts?: number;
  language?: string;
}

/**
 * Location info structure
 */
interface LocationInfo {
  success: boolean;
  latitude?: string;
  longitude?: string;
  description?: string;
  regionName?: string | null;
  isCity?: boolean;
  error?: string;
}

/**
 * Location result with acknowledgment message
 */
interface LocationResultWithAck extends LocationInfo {
  ackMessage?: string | null;
  requestedRegion?: RequestedRegion | null;
}

/**
 * Find random location within requested region
 */
export async function findRandomLocation({ requestedRegion, maxAttempts = 15, language = 'he' }: FindRandomLocationParams): Promise<LocationInfo> {
  let locationInfo: { latitude: string; longitude: string; description: string; [key: string]: unknown } | null = null;
  let attempts = 0;

  const hasSpecificBounds = !!(requestedRegion && requestedRegion.bounds);

  let availableContinents = [...continents];

  if (requestedRegion) {
    const requestedRegionName = requestedRegion.continentName;
    const hasMultiRegions = requestedRegion.multiRegions && Array.isArray(requestedRegion.multiRegions);

    if (requestedRegionName && !hasSpecificBounds) {
      if (hasMultiRegions) {
        availableContinents = continents.filter(c => requestedRegion.multiRegions!.includes(c.name));
        if (availableContinents.length === 0) {
          availableContinents = [...continents];
        }
      } else {
        availableContinents = continents.filter(c => c.name === requestedRegionName);
        if (availableContinents.length === 0) {
          availableContinents = [...continents];
        }
      }
    }
  }

  let useBoundsForGeneration: boolean = hasSpecificBounds;

  while (attempts < maxAttempts && !locationInfo) {
    attempts++;

    let latitude: string | undefined;
    let longitude: string | undefined;

    if (useBoundsForGeneration && requestedRegion && requestedRegion.bounds) {
      const bounds = requestedRegion.bounds;
      if (
        bounds &&
        typeof bounds.minLat === 'number' && typeof bounds.maxLat === 'number' &&
        typeof bounds.minLng === 'number' && typeof bounds.maxLng === 'number' &&
        bounds.minLat < bounds.maxLat && bounds.minLng < bounds.maxLng &&
        bounds.minLat >= -90 && bounds.maxLat <= 90 &&
        bounds.minLng >= -180 && bounds.maxLng <= 180
      ) {
        latitude = (Math.random() * (bounds.maxLat - bounds.minLat) + bounds.minLat).toFixed(6);
        longitude = (Math.random() * (bounds.maxLng - bounds.minLng) + bounds.minLng).toFixed(6);
      } else {
        useBoundsForGeneration = false;
      }
    } else {
      useBoundsForGeneration = false;
    }

    if (!useBoundsForGeneration || !latitude || !longitude) {
      const totalWeight = availableContinents.reduce((sum, c) => sum + c.weight, 0) || 1;
      let randomWeight = Math.random() * totalWeight;
      let selectedContinent = availableContinents[0] || continents[0]!;

      for (const continent of availableContinents) {
        randomWeight -= continent.weight;
        if (randomWeight <= 0) {
          selectedContinent = continent;
          break;
        }
      }

      latitude = (Math.random() * (selectedContinent.maxLat - selectedContinent.minLat) + selectedContinent.minLat).toFixed(6);
      longitude = (Math.random() * (selectedContinent.maxLng - selectedContinent.minLng) + selectedContinent.minLng).toFixed(6);
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getLocationInfo: getLocationInfoFn } = require('../geminiService');
    const tempLocationInfo = await getLocationInfoFn(parseFloat(latitude!), parseFloat(longitude!), language) as { success?: boolean; description?: string; [key: string]: unknown };

    if (tempLocationInfo.success && tempLocationInfo.description) {
      if (isLandLocation(tempLocationInfo.description as string)) {
        locationInfo = { ...tempLocationInfo, latitude: latitude!, longitude: longitude! } as { latitude: string; longitude: string; description: string; [key: string]: unknown };
      }
    }
  }

  if (!locationInfo) {
    return {
      success: false,
      error: language === 'he' 
        ? `לא הצלחתי למצוא מיקום תקין אחרי ${maxAttempts} ניסיונות`
        : `Could not find a valid location after ${maxAttempts} attempts`
    };
  }

  return {
    success: true,
    latitude: locationInfo.latitude,
    longitude: locationInfo.longitude,
    description: locationInfo.description,
    regionName: requestedRegion?.displayName || null,
    isCity: requestedRegion?.isCity === true
  };
}

/**
 * Get random location for prompt
 */
export async function getRandomLocationForPrompt(prompt: string | null | undefined): Promise<LocationResultWithAck> {
  const requestedRegion = await extractRequestedRegion(prompt || '');
  const ackMessage = buildLocationAckMessage(requestedRegion);
  const locationResult = await findRandomLocation({ requestedRegion });
  return {
    ...locationResult,
    ackMessage,
    requestedRegion
  };
}

