/**
 * Location extraction from prompts
 */

import { getLocationBounds } from '../geminiService';
import { countryBoundsData, cityBoundsData, cityKeywords, regionMap } from './constants';

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

  const promptLower = prompt.toLowerCase();
  console.log(`🔍 extractRequestedRegion called with: "${prompt}"`);
  console.log(`📍 Prompt lowercase: "${promptLower}"`);

  // Check for explicit city mentions first
  let detectedCity: string | null = null;
  for (const cityName in cityKeywords) {
    const cityNameLower = cityName.toLowerCase();
    const escapedCityName = cityNameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const cityPatterns = [
      new RegExp(`\\b${escapedCityName}\\b`, 'i'),
      new RegExp(`ב-?${escapedCityName}(?:[^א-תa-z]|$)`, 'i'),
      new RegExp(`באזור\\s*${escapedCityName}`, 'i'),
      new RegExp(`in\\s+${escapedCityName}`, 'i'),
      new RegExp(`${escapedCityName}`, 'i')
    ];

    if (cityPatterns.some(pattern => pattern.test(promptLower))) {
      console.log(`🏙️ Detected explicit city mention: "${cityName}" - prioritizing over countries`);
      detectedCity = cityName;
      break;
    }
  }

  if (detectedCity) {
    // Try static data first
    const cityData = cityBoundsData as Record<string, ExtractedRegion['bounds']>;
    if (cityData && cityData[detectedCity]) {
      return {
        continentName: null,
        displayName: detectedCity,
        bounds: cityData[detectedCity],
        isCity: true
      };
    }

    // If not in static data, try geocoding
    console.log(`🌍 City "${detectedCity}" not in static data, trying geocoding...`);
    try {
      const bounds = (await getLocationBounds(detectedCity)) as BoundsResult | null;
      if (bounds) {
        console.log(`✅ Found city bounds for "${detectedCity}" via geocoding`);
        return {
          continentName: null,
          displayName: (bounds.foundName as string) || detectedCity,
          bounds: bounds,
          isCity: true
        };
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️ Error geocoding city "${detectedCity}":`, errorMessage);
    }
  }

  // Check exact match in regionMap
  const regionMapTyped = regionMap as Record<string, string | { continent: string; display: string; multiRegions?: string[] }>;
  if (regionMapTyped[promptLower] || regionMapTyped[prompt]) {
    const mapping = regionMapTyped[promptLower] || regionMapTyped[prompt];
    if (typeof mapping === 'string') {
      return {
        continentName: mapping,
        displayName: prompt
      };
    }
    const mappingObj = mapping as { continent: string; display: string; multiRegions?: string[] };
    return {
      continentName: mappingObj.continent,
      displayName: mappingObj.display,
      bounds: null,
      isCity: false,
      multiRegions: mappingObj.multiRegions || null
    };
  }

  // Check word by word
  const words = promptLower.split(/[\s,]+/);
  for (const word of words) {
    const wordIndex = words.indexOf(word);
    const originalWord = prompt.split(/[\s,]+/)[wordIndex];
    if (originalWord && (regionMapTyped[word] || regionMapTyped[originalWord])) {
      const mapping = regionMapTyped[word] || regionMapTyped[originalWord];
      if (typeof mapping === 'string') {
        return {
          continentName: mapping,
          displayName: originalWord || word
        };
      }
      const mappingObj = mapping as { continent: string; display: string; multiRegions?: string[] };
      return {
        continentName: mappingObj.continent,
        displayName: mappingObj.display,
        bounds: null,
        isCity: false,
        multiRegions: mappingObj.multiRegions || null
      };
    }
  }

  // Check country bounds data
  const countryData = countryBoundsData as Record<string, unknown>;
  if (countryData) {
    for (const countryKey of Object.keys(countryData)) {
      const countryInfo = countryData[countryKey];
      if (!countryInfo || typeof countryInfo !== 'object') {
        continue;
      }

      const escapedCountryKey = countryKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const countryPatterns = [
        new RegExp(`(?:^|[\\s,\\.\\-\\(\\)\\[\\{])(${escapedCountryKey})(?=$|[\\s,\\.\\-\\)\\]\\}])`, 'i'),
        new RegExp(`באזור\\s*(${escapedCountryKey})`, 'i'),
        new RegExp(`ב-?(${escapedCountryKey})(?=$|[^\\p{L}\\p{N}])`, 'iu')
      ];

      let matchValue: string | null = null;
      for (const pattern of countryPatterns) {
        const match = pattern.exec(prompt);
        if (match && match[1]) {
          matchValue = match[1];
          break;
        }
      }

      if (!matchValue) {
        continue;
      }

      const boundsSource = (countryInfo as { bounds?: unknown }).bounds && typeof (countryInfo as { bounds?: unknown }).bounds === 'object'
        ? (countryInfo as { bounds: unknown }).bounds
        : countryInfo;

      const bounds = boundsSource as { minLat?: number; maxLat?: number; minLng?: number; maxLng?: number };
      if (
        typeof bounds.minLat === 'number' &&
        typeof bounds.maxLat === 'number' &&
        typeof bounds.minLng === 'number' &&
        typeof bounds.maxLng === 'number'
      ) {
        const regionMapTyped = regionMap as Record<string, string | { continent?: string }>;
        const regionMeta = (regionMapTyped[countryKey] || regionMapTyped[countryKey.toLowerCase()]) as { continent?: string } | undefined;
        return {
          continentName: (regionMeta && regionMeta.continent) || null,
          displayName: matchValue || countryKey,
          bounds: {
            minLat: bounds.minLat,
            maxLat: bounds.maxLat,
            minLng: bounds.minLng,
            maxLng: bounds.maxLng
          },
          isCity: false
        };
      }
    }
  }

  // Try to extract location name from prompt
  console.log(`🔍 No country/region found, trying to find city/location in prompt: "${prompt}"`);

  let cleanPrompt = prompt
    .replace(/^(שלח|שלחי|שלחו|תשלח|תשלחי|תשלחו)\s+(מיקום|location)/i, '')
    .replace(/מיקום\s+(אקראי|random)/gi, '')
    .replace(/location\s+(random|אקראי)/gi, '')
    .replace(/שלח\s+(מיקום|location)/gi, '')
    .replace(/send\s+(location|מיקום)/gi, '')
    .trim();

  const locationPatterns = [
    /באזור\s+(.+?)(?:\s|$|,|\.|!|\?|:|\))/i,
    /באזור\s*(.+?)$/i,
    /ב-?(.+?)(?:\s|$|,|\.|!|\?|:|\))/i,
    /ב-?(.+?)$/i,
    /in\s+(?:the\s+)?(?:area\s+of\s+)?(.+?)(?:\s|$|,|\.|!|\?|:|\))/i,
    /in\s+(?:the\s+)?(.+?)$/i,
    /near\s+(.+?)(?:\s|$|,|\.|!|\?|:|\))/i,
    /near\s+(.+?)$/i,
    /^([א-תa-z]+(?:\s+[א-תa-z]+)*)$/i
  ];

  const skipWords = new Set([
    'שלח', 'מיקום', 'אקראי', 'location', 'random', 'send', 'in', 'the', 'region', 'of',
    'אזור', 'ב', 'באזור', 'near', 'area', 'את', 'אתה', 'אתי', 'אתם', 'אתן',
    'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were'
  ]);

  let locationName: string | null = null;
  for (const pattern of locationPatterns) {
    const match = cleanPrompt.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].trim();
      if (candidate.length >= 2 &&
        !skipWords.has(candidate.toLowerCase()) &&
        /[א-תa-z]/.test(candidate)) {
        locationName = candidate;
        console.log(`🌍 Extracted location name: "${locationName}"`);
        break;
      }
    }
  }

  if (locationName) {
    console.log(`🌍 Attempting to geocode city/location: "${locationName}"`);
    try {
      const bounds = (await getLocationBounds(locationName)) as BoundsResult | null;
      if (bounds) {
        console.log(`✅ Found city/location bounds for "${locationName}"`);
        return {
          continentName: null,
          displayName: (bounds.foundName as string) || locationName,
          bounds: bounds,
          isCity: ((bounds.type as string) || '').toLowerCase().includes('city')
        };
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️ Error geocoding "${locationName}":`, errorMessage);
    }
  }

  // Final fallback: try entire prompt
  if (prompt && prompt.trim()) {
    const trimmedPrompt = prompt.trim();
    console.log(`🌍 Final geocode attempt for prompt: "${trimmedPrompt}"`);
    try {
      const bounds = (await getLocationBounds(trimmedPrompt)) as BoundsResult | null;
      if (bounds) {
        console.log(`✅ Found bounds for prompt "${trimmedPrompt}" via geocode`);
        return {
          continentName: null,
          displayName: (bounds.foundName as string) || trimmedPrompt,
          bounds: bounds,
          isCity: ((bounds.type as string) || '').toLowerCase().includes('city')
        };
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️ Final geocode attempt failed for "${trimmedPrompt}":`, errorMessage);
    }
  }

  console.log(`❌ No region/city found in prompt: "${prompt}"`);
  return null;
}
