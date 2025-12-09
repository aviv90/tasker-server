import { GoogleGenerativeAI } from '@google/generative-ai';
import { cleanJsonWrapper } from '../../../utils/textSanitizer';
import logger from '../../../utils/logger';
import prompts from '../../../config/prompts';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Location result
 */
interface LocationResult {
  success: boolean;
  description?: string;
  latitude?: number;
  longitude?: number;
  usedMapsGrounding?: boolean;
  error?: string;
}

/**
 * Location bounds
 */
interface LocationBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  foundName: string;
  city: string | null;
  country: string | null;
  type: string;
}

/**
 * Location services operations
 */
class LocationService {
  /**
   * Clean JSON/snippets from response if Gemini accidentally returned structured data
   * Uses centralized cleanJsonWrapper utility for consistency
   */
  cleanLocationResponse(text: string): string {
    // Use centralized JSON cleaning utility
    return cleanJsonWrapper(text);
  }

  /**
   * Get location information using Google Maps grounding
   */
  async getLocationInfo(latitude: number, longitude: number, language = 'he'): Promise<LocationResult> {
    try {
      logger.debug(`🗺️ Getting location info for: ${latitude}, ${longitude} (Language: ${language})`);

      const model = genAI.getGenerativeModel({
        model: "gemini-3-pro-preview"
      });

      let text = '';
      let usedMapsGrounding = false;
      
      try {
        logger.debug('🗺️ Trying Google Maps Grounding first...');
        
        // Use SSOT prompt from config/prompts.ts
        const mapsPrompt = prompts.locationMapsPrompt(latitude, longitude, language);

         
        const mapsResult = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: mapsPrompt }] }],
          tools: [{
            googleMaps: {}
          }],
          toolConfig: {
            retrievalConfig: {
              latLng: {
                latitude: latitude,
                longitude: longitude
              }
            }
          }
        } as any);


        const mapsResponse = mapsResult.response;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapsResponseAny = mapsResponse as any;
        if (mapsResponseAny.candidates && mapsResponseAny.candidates.length > 0) {
          text = mapsResponse.text();

          // Check if Maps Grounding gave a useful answer
          const unhelpfulPatterns = [
            'אני זקוק למיקום', 'אני צריך מיקום', 'איזה מיקום', 'איזה מקום',
            'ספק את שם', 'ספק שם', 'ספקי את', 'ספק לי פרטים', 'ספקו פרטים',
            'כדי שאוכל לתאר', 'כדי לתאר', 'אנא ספק', 'לא צוין מיקום',
            'לא צוינה', 'לא ניתן מיקום', 'I need a location',
            'I need more information', 'which location', 'which place',
            'provide the location', 'provide the place', 'provide a location',
            'provide more details', 'provide details', 'not specified',
            'no location specified', 'location not specified', 'אנא ציין',
            'please specify', 'לא ברור', 'unclear', 'לא יכול לתאר', 'cannot describe'
          ];

          const isUnhelpful = unhelpfulPatterns.some(pattern =>
            text.toLowerCase().includes(pattern.toLowerCase())
          );

          if (!isUnhelpful && text.trim().length > 20) {
            logger.debug('✅ Google Maps Grounding provided useful info');
            usedMapsGrounding = true;
          } else {
            logger.debug('⚠️ Google Maps Grounding response not useful, falling back to general knowledge...');
            text = '';
          }
        }
      } catch (_mapsError) {
        // Google Maps Grounding often fails for coordinate-based queries, which is expected
        // Fall back to general knowledge without alarming logs
        logger.debug(`🔄 Google Maps Grounding unavailable, using general knowledge...`);
        text = '';
      }

      // Fallback: Use Gemini's general geographic knowledge
      if (!text || text.trim().length === 0) {
        logger.debug('🌍 Using Gemini general geographic knowledge...');
        
        // Use SSOT prompt from config/prompts.ts
        const generalPrompt = prompts.locationGeneralPrompt(latitude, longitude, language);

        const generalResult = await model.generateContent(generalPrompt);
        const generalResponse = generalResult.response;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const generalResponseAny = generalResponse as any;
        if (!generalResponseAny.candidates || generalResponseAny.candidates.length === 0) {
          logger.warn('❌ Gemini: No candidates returned');
          return {
            success: false,
            error: 'No response from Gemini'
          };
        }

        text = generalResponse.text();
      }

      if (!text || text.trim().length === 0) {
        logger.warn('❌ Gemini: Empty text response');
        return {
          success: false,
          error: 'Empty response from Gemini'
        };
      }

      // Clean JSON/snippets from response
      text = text.trim();
      text = this.cleanLocationResponse(text);

      // Final validation: ensure we still have meaningful text
      if (!text || text.length < 10) {
        const isHebrew = language === 'he' || language === 'Hebrew';
        text = isHebrew 
          ? `מיקום: קו רוחב ${latitude}°, קו אורך ${longitude}°`
          : `Location: Latitude ${latitude}°, Longitude ${longitude}°`;
      }

      logger.info(`✅ Location info retrieved (${usedMapsGrounding ? 'Maps Grounding' : 'General Knowledge'}): ${text.substring(0, 100)}...`);

      return {
        success: true,
        description: text,
        latitude: latitude,
        longitude: longitude,
        usedMapsGrounding: usedMapsGrounding
      };

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to get location info';
      logger.error('❌ Gemini error:', { error: errorMessage, stack: err instanceof Error ? err.stack : undefined });
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Parse and validate location bounds from geocoding response
   */
  parseLocationBounds(text: string, locationName: string): LocationBounds | null {
    let locationData: unknown = null;

    try {
      // First try: Extract JSON (might have markdown code blocks like ```json ... ```)
      let jsonText = text;

      // Remove markdown code blocks if present
      const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch && codeBlockMatch[1]) {
        jsonText = codeBlockMatch[1];
      } else {
        // Extract JSON object
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonText = jsonMatch[0];
        }
      }

      locationData = JSON.parse(jsonText);
    } catch (_parseErr) {
      // Fallback: Try to extract coordinates and bounds from text using regex
      const latMatch = text.match(/latitude[":\s]+(-?[0-9.]+)/i);
      const lngMatch = text.match(/longitude[":\s]+(-?[0-9.]+)/i);

      // Try to extract viewport if available
      const northMatch = text.match(/north[":\s]+(-?[0-9.]+)/i);
      const southMatch = text.match(/south[":\s]+(-?[0-9.]+)/i);
      const eastMatch = text.match(/east[":\s]+(-?[0-9.]+)/i);
      const westMatch = text.match(/west[":\s]+(-?[0-9.]+)/i);

      if (latMatch && latMatch[1] && lngMatch && lngMatch[1]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = {
          latitude: parseFloat(latMatch[1]),
          longitude: parseFloat(lngMatch[1]),
          found: true
        };

        // If viewport found, add it
        if (northMatch && northMatch[1] && southMatch && southMatch[1] && 
            eastMatch && eastMatch[1] && westMatch && westMatch[1]) {
          data.viewport = {
            north: parseFloat(northMatch[1]),
            south: parseFloat(southMatch[1]),
            east: parseFloat(eastMatch[1]),
            west: parseFloat(westMatch[1])
          };
        }

        locationData = data;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const locData = locationData as any;
    if (!locData || !locData.found) {
      logger.warn(`❌ Location not found: ${locationName}`);
      return null;
    }

    // Extract metadata
    const foundName = locData.found_name || locData.city || locationName;
    const city = locData.city || null;
    const country = locData.country || null;
    const locationType = locData.type || 'unknown';

    // VALIDATION: Check if found location name reasonably matches requested name
    const requestedLower = locationName.toLowerCase().trim();
    const foundLower = String(foundName).toLowerCase().trim();
    const cityLower = (city || '').toLowerCase().trim();

    const isReasonableMatch =
      foundLower.includes(requestedLower) ||
      requestedLower.includes(foundLower) ||
      (cityLower && cityLower.includes(requestedLower)) ||
      (cityLower && requestedLower.includes(cityLower)) ||
      (requestedLower.length >= 3 && foundLower.length >= 3 && foundLower.slice(0, 3) === requestedLower.slice(0, 3));

    if (!isReasonableMatch) {
      logger.warn(`⚠️ Location mismatch: requested "${locationName}" but got "${foundName}". Rejecting.`);
      return null;
    }

    logger.debug(`✅ Location validation passed: requested "${locationName}" → found "${foundName}" (${country || 'unknown country'})`);

    // Validate coordinates
    const centerLat = parseFloat(locData.latitude);
    const centerLng = parseFloat(locData.longitude);

    if (isNaN(centerLat) || isNaN(centerLng) ||
      centerLat < -90 || centerLat > 90 ||
      centerLng < -180 || centerLng > 180) {
      logger.warn(`❌ Invalid coordinates for "${locationName}": lat=${centerLat}, lng=${centerLng}`);
      return null;
    }

    // If viewport/bounds are available, use them (most accurate)
    if (locData.viewport &&
      locData.viewport.north && locData.viewport.south &&
      locData.viewport.east && locData.viewport.west) {

      const bounds: LocationBounds = {
        minLat: Math.min(locData.viewport.south, locData.viewport.north),
        maxLat: Math.max(locData.viewport.south, locData.viewport.north),
        minLng: Math.min(locData.viewport.west, locData.viewport.east),
        maxLng: Math.max(locData.viewport.west, locData.viewport.east),
        foundName,
        city,
        country,
        type: locationType
      };

      // Validate bounds
      if (bounds.minLat >= -90 && bounds.maxLat <= 90 &&
        bounds.minLng >= -180 && bounds.maxLng <= 180 &&
        bounds.minLat < bounds.maxLat && bounds.minLng < bounds.maxLng) {
        logger.debug(`✅ Found viewport bounds for "${locationName}" (${foundName}): ${JSON.stringify({ minLat: bounds.minLat, maxLat: bounds.maxLat, minLng: bounds.minLng, maxLng: bounds.maxLng })}`);
        return bounds;
      }
    }

    // Fallback: Calculate bounds from center point with dynamic radius
    const baseRadius = 0.4; // ~44km at equator
    const latAdjustment = Math.cos(centerLat * Math.PI / 180);

    const bounds: LocationBounds = {
      minLat: Math.max(-90, centerLat - baseRadius),
      maxLat: Math.min(90, centerLat + baseRadius),
      minLng: Math.max(-180, centerLng - (baseRadius / latAdjustment)),
      maxLng: Math.min(180, centerLng + (baseRadius / latAdjustment)),
      foundName,
      city,
      country,
      type: locationType
    };

    logger.debug(`✅ Found center-point bounds for "${locationName}" (${foundName}): ${JSON.stringify({ minLat: bounds.minLat, maxLat: bounds.maxLat, minLng: bounds.minLng, maxLng: bounds.maxLng })}`);
    return bounds;
  }

  /**
   * Get bounds for a city/location name using Google Maps Geocoding
   */
  async getLocationBounds(locationName: string): Promise<LocationBounds | null> {
    try {
      logger.debug(`🔍 Getting bounds for location: "${locationName}"`);

      const model = genAI.getGenerativeModel({
        model: "gemini-3-pro-preview"
      });

      const geocodePrompt = `מצא את המקום הבא ב-Google Maps וחזור עם המידע הגיאוגרפי המדויק שלו:

שם המקום שהמשתמש ביקש: ${locationName}

החזר JSON בלבד בפורמט הבא:
{
  "found_name": "שם המקום המלא שנמצא (כולל עיר ומדינה, לדוגמה: Tel Aviv, Israel)",
  "city": "שם העיר בלבד",
  "country": "שם המדינה",
  "latitude": מספר קו רוחב (נקודת מרכז),
  "longitude": מספר קו אורך (נקודת מרכז),
  "viewport": {
    "north": מספר (קו רוחב מקסימלי),
    "south": מספר (קו רוחב מינימלי),
    "east": מספר (קו אורך מקסימלי),
    "west": מספר (קו אורך מינימלי)
  },
  "type": "city/country/region",
  "found": true/false
}

חשוב מאוד:
- וודא שהמקום שמצאת תואם למה שהמשתמש ביקש
- אם המשתמש ביקש "תל אביב", אל תחזיר "טוקיו"
- אם יש viewport/bounds ב-Google Maps, השתמש בהם (מדויק יותר)
- אם אין viewport, השתמש בקואורדינטות המרכז בלבד
- וודא שהקואורדינטות בתוך הטווחים התקפים: קו רוחב בין -90 ל-90, קו אורך בין -180 ל-180
- אם לא מצאת את המקום או יש אי-התאמה, החזר {"found": false}`;

      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: geocodePrompt }] }]
      });

      const response = result.response;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseAny = response as any;
      if (!responseAny.candidates || responseAny.candidates.length === 0) {
        logger.warn(`❌ No response for location: ${locationName}`);
        return null;
      }

      const text = response.text();
      logger.debug(`📍 Geocoding response for "${locationName}": ${text.substring(0, 200)}`);

      return this.parseLocationBounds(text, locationName);

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : '';
      logger.error(`❌ Error getting bounds for "${locationName}":`, { error: errorMessage, stack: errorStack });
      return null;
    }
  }
}

export default new LocationService();

