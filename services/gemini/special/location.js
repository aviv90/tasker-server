const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Location services operations
 */
class LocationService {
  /**
   * Clean JSON/snippets from response if Gemini accidentally returned structured data
   */
  cleanLocationResponse(text) {
    // Remove JSON blocks (```json ... ``` or naked JSON objects)
    if (text.includes('"snippets"') || text.includes('"link"') || (text.startsWith('{') && text.endsWith('}'))) {
      console.warn('⚠️ Detected JSON in location description, cleaning...');

      try {
        // Remove markdown code blocks
        let cleanText = text.replace(/```json?\s*|\s*```/g, '');

        // Try to parse as JSON
        const jsonData = JSON.parse(cleanText);

        // Extract meaningful text fields (not snippets or links)
        if (jsonData.description) {
          return jsonData.description;
        } else if (jsonData.text) {
          return jsonData.text;
        } else if (jsonData.answer) {
          return jsonData.answer;
        } else {
          // Fallback: extract any long string values (likely the description)
          for (const key in jsonData) {
            if (typeof jsonData[key] === 'string' && jsonData[key].length > 30 &&
              key !== 'link' && key !== 'snippets') {
              return jsonData[key];
            }
          }
        }
      } catch (err) {
        // If JSON parsing fails, remove JSON-like patterns
        console.warn(`⚠️ Could not parse JSON, removing patterns: ${err.message}`);
        return text
          .replace(/\{[^}]*"snippets"[^}]*\}/g, '')
          .replace(/\{[^}]*"link"[^}]*\}/g, '')
          .replace(/```json?\s*[\s\S]*?\s*```/g, '')
          .trim();
      }
    }

    return text;
  }

  /**
   * Get location information using Google Maps grounding
   * @param {number} latitude - Latitude
   * @param {number} longitude - Longitude
   * @param {string} [language='he'] - Output language (e.g., 'he', 'en')
   */
  async getLocationInfo(latitude, longitude, language = 'he') {
    try {
      console.log(`🗺️ Getting location info for: ${latitude}, ${longitude} (Language: ${language})`);

      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash"
      });

      let text = '';
      let usedMapsGrounding = false;
      
      // Language-specific instructions
      const isHebrew = language === 'he' || language === 'Hebrew';
      const langName = isHebrew ? 'Hebrew' : (language === 'en' ? 'English' : language);
      const langInstruction = isHebrew ? 'בעברית' : `in ${langName}`;
      
      try {
        console.log('🗺️ Trying Google Maps Grounding first...');
        
        // Dynamic prompt based on language
        let mapsPrompt;
        if (isHebrew) {
          mapsPrompt = `תאר את המיקום בקואורדינטות: קו רוחב ${latitude}°, קו אורך ${longitude}°.
            
באיזו עיר או אזור זה נמצא? באיזו מדינה? מה מעניין או מפורסם במקום הזה?

תשובה קצרה ומעניינת בעברית (2-3 שורות).`;
        } else {
          mapsPrompt = `Describe the location at coordinates: Latitude ${latitude}°, Longitude ${longitude}°.
            
Which city or region is this in? Which country? What is interesting or famous about this place?

Short and interesting answer in ${langName} (2-3 lines).`;
        }

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
        });


        const mapsResponse = mapsResult.response;
        if (mapsResponse.candidates && mapsResponse.candidates.length > 0) {
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
            console.log('✅ Google Maps Grounding provided useful info');
            usedMapsGrounding = true;
          } else {
            console.log('⚠️ Google Maps Grounding response not useful, falling back to general knowledge...');
            text = '';
          }
        }
      } catch (mapsError) {
        // Google Maps Grounding often fails for coordinate-based queries, which is expected
        // Fall back to general knowledge without alarming logs
        console.log(`🔄 Google Maps Grounding unavailable, using general knowledge...`);
        text = '';
      }

      // Fallback: Use Gemini's general geographic knowledge
      if (!text || text.trim().length === 0) {
        console.log('🌍 Using Gemini general geographic knowledge...');
        
        let generalPrompt;
        if (isHebrew) {
          generalPrompt = `תאר את המיקום הגיאוגרפי: קו רוחב ${latitude}°, קו אורך ${longitude}°.

ספר בקצרה (2-3 שורות):
- באיזו מדינה, אזור או אוקיינוס זה נמצא
- מה האקלים והטבע של האזור
- אם יש שם משהו מעניין או מפורסם, ציין את זה

תשובה מעניינת בעברית.`;
        } else {
          generalPrompt = `Describe the geographic location: Latitude ${latitude}°, Longitude ${longitude}°.

Briefly describe (2-3 lines):
- Which country, region, or ocean is it in?
- What is the climate and nature of the area?
- If there is something interesting or famous there, mention it.

Interesting answer in ${langName}.`;
        }

        const generalResult = await model.generateContent(generalPrompt);
        const generalResponse = generalResult.response;

        if (!generalResponse.candidates || generalResponse.candidates.length === 0) {
          console.log('❌ Gemini: No candidates returned');
          return {
            success: false,
            error: 'No response from Gemini'
          };
        }

        text = generalResponse.text();
      }

      if (!text || text.trim().length === 0) {
        console.log('❌ Gemini: Empty text response');
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
        text = isHebrew 
          ? `מיקום: קו רוחב ${latitude}°, קו אורך ${longitude}°`
          : `Location: Latitude ${latitude}°, Longitude ${longitude}°`;
      }

      console.log(`✅ Location info retrieved (${usedMapsGrounding ? 'Maps Grounding' : 'General Knowledge'}): ${text.substring(0, 100)}...`);

      return {
        success: true,
        description: text,
        latitude: latitude,
        longitude: longitude,
        usedMapsGrounding: usedMapsGrounding
      };

    } catch (err) {
      console.error('❌ Gemini error:', err);
      return {
        success: false,
        error: err.message || 'Failed to get location info'
      };
    }
  }

  /**
   * Parse and validate location bounds from geocoding response
   */
  parseLocationBounds(text, locationName) {
    let locationData = null;

    try {
      // First try: Extract JSON (might have markdown code blocks like ```json ... ```)
      let jsonText = text;

      // Remove markdown code blocks if present
      const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1];
      } else {
        // Extract JSON object
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonText = jsonMatch[0];
        }
      }

      locationData = JSON.parse(jsonText);
    } catch (parseErr) {
      console.warn(`⚠️ Could not parse JSON from geocoding response:`, parseErr.message);
      // Fallback: Try to extract coordinates and bounds from text using regex
      const latMatch = text.match(/latitude[":\s]+(-?[0-9.]+)/i);
      const lngMatch = text.match(/longitude[":\s]+(-?[0-9.]+)/i);

      // Try to extract viewport if available
      const northMatch = text.match(/north[":\s]+(-?[0-9.]+)/i);
      const southMatch = text.match(/south[":\s]+(-?[0-9.]+)/i);
      const eastMatch = text.match(/east[":\s]+(-?[0-9.]+)/i);
      const westMatch = text.match(/west[":\s]+(-?[0-9.]+)/i);

      if (latMatch && lngMatch) {
        locationData = {
          latitude: parseFloat(latMatch[1]),
          longitude: parseFloat(lngMatch[1]),
          found: true
        };

        // If viewport found, add it
        if (northMatch && southMatch && eastMatch && westMatch) {
          locationData.viewport = {
            north: parseFloat(northMatch[1]),
            south: parseFloat(southMatch[1]),
            east: parseFloat(eastMatch[1]),
            west: parseFloat(westMatch[1])
          };
        }
      }
    }

    if (!locationData || !locationData.found) {
      console.log(`❌ Location not found: ${locationName}`);
      return null;
    }

    // Extract metadata
    const foundName = locationData.found_name || locationData.city || locationName;
    const city = locationData.city || null;
    const country = locationData.country || null;
    const locationType = locationData.type || 'unknown';

    // VALIDATION: Check if found location name reasonably matches requested name
    const requestedLower = locationName.toLowerCase().trim();
    const foundLower = foundName.toLowerCase().trim();
    const cityLower = (city || '').toLowerCase().trim();

    const isReasonableMatch =
      foundLower.includes(requestedLower) ||
      requestedLower.includes(foundLower) ||
      cityLower.includes(requestedLower) ||
      requestedLower.includes(cityLower) ||
      (requestedLower.length >= 3 && foundLower.slice(0, 3) === requestedLower.slice(0, 3));

    if (!isReasonableMatch) {
      console.warn(`⚠️ Location mismatch: requested "${locationName}" but got "${foundName}". Rejecting.`);
      return null;
    }

    console.log(`✅ Location validation passed: requested "${locationName}" → found "${foundName}" (${country || 'unknown country'})`);

    // Validate coordinates
    const centerLat = parseFloat(locationData.latitude);
    const centerLng = parseFloat(locationData.longitude);

    if (isNaN(centerLat) || isNaN(centerLng) ||
      centerLat < -90 || centerLat > 90 ||
      centerLng < -180 || centerLng > 180) {
      console.log(`❌ Invalid coordinates for "${locationName}": lat=${centerLat}, lng=${centerLng}`);
      return null;
    }

    // If viewport/bounds are available, use them (most accurate)
    if (locationData.viewport &&
      locationData.viewport.north && locationData.viewport.south &&
      locationData.viewport.east && locationData.viewport.west) {

      const bounds = {
        minLat: Math.min(locationData.viewport.south, locationData.viewport.north),
        maxLat: Math.max(locationData.viewport.south, locationData.viewport.north),
        minLng: Math.min(locationData.viewport.west, locationData.viewport.east),
        maxLng: Math.max(locationData.viewport.west, locationData.viewport.east),
        foundName,
        city,
        country,
        type: locationType
      };

      // Validate bounds
      if (bounds.minLat >= -90 && bounds.maxLat <= 90 &&
        bounds.minLng >= -180 && bounds.maxLng <= 180 &&
        bounds.minLat < bounds.maxLat && bounds.minLng < bounds.maxLng) {
        console.log(`✅ Found viewport bounds for "${locationName}" (${foundName}): ${JSON.stringify({ minLat: bounds.minLat, maxLat: bounds.maxLat, minLng: bounds.minLng, maxLng: bounds.maxLng })}`);
        return bounds;
      }
    }

    // Fallback: Calculate bounds from center point with dynamic radius
    const baseRadius = 0.4; // ~44km at equator
    const latAdjustment = Math.cos(centerLat * Math.PI / 180);

    const bounds = {
      minLat: Math.max(-90, centerLat - baseRadius),
      maxLat: Math.min(90, centerLat + baseRadius),
      minLng: Math.max(-180, centerLng - (baseRadius / latAdjustment)),
      maxLng: Math.min(180, centerLng + (baseRadius / latAdjustment)),
      foundName,
      city,
      country,
      type: locationType
    };

    console.log(`✅ Found center-point bounds for "${locationName}" (${foundName}): ${JSON.stringify({ minLat: bounds.minLat, maxLat: bounds.maxLat, minLng: bounds.minLng, maxLng: bounds.maxLng })}`);
    return bounds;
  }

  /**
   * Get bounds for a city/location name using Google Maps Geocoding
   */
  async getLocationBounds(locationName) {
    try {
      console.log(`🔍 Getting bounds for location: "${locationName}"`);

      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash"
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
      if (!response.candidates || response.candidates.length === 0) {
        console.log(`❌ No response for location: ${locationName}`);
        return null;
      }

      const text = response.text();
      console.log(`📍 Geocoding response for "${locationName}": ${text.substring(0, 200)}`);

      return this.parseLocationBounds(text, locationName);

    } catch (err) {
      console.error(`❌ Error getting bounds for "${locationName}":`, err.message);
      console.error(`   Stack: ${err.stack}`);
      return null;
    }
  }
}

module.exports = new LocationService();

