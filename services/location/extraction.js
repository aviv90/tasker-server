/**
 * Location extraction from prompts
 */

const { getLocationBounds } = require('../geminiService');
const { countryBoundsData, cityBoundsData, cityKeywords, regionMap } = require('./constants');

/**
 * Extract requested region/city from prompt
 */
async function extractRequestedRegion(prompt) {
  if (!prompt || typeof prompt !== 'string') return null;

  const promptLower = prompt.toLowerCase();
  console.log(`🔍 extractRequestedRegion called with: "${prompt}"`);
  console.log(`📍 Prompt lowercase: "${promptLower}"`);

  // Check for explicit city mentions first
  let detectedCity = null;
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
    if (cityBoundsData && cityBoundsData[detectedCity]) {
      return {
        continentName: null,
        displayName: detectedCity,
        bounds: cityBoundsData[detectedCity],
        isCity: true
      };
    }

    // If not in static data, try geocoding
    console.log(`🌍 City "${detectedCity}" not in static data, trying geocoding...`);
    try {
      const bounds = await getLocationBounds(detectedCity);
      if (bounds) {
        console.log(`✅ Found city bounds for "${detectedCity}" via geocoding`);
        return {
          continentName: null,
          displayName: bounds.foundName || detectedCity,
          bounds,
          isCity: true
        };
      }
    } catch (err) {
      console.warn(`⚠️ Error geocoding city "${detectedCity}":`, err.message);
    }
  }

  // Check exact match in regionMap
  if (regionMap[promptLower] || regionMap[prompt]) {
    const mapping = regionMap[promptLower] || regionMap[prompt];
    if (typeof mapping === 'string') {
      return {
        continentName: mapping,
        displayName: prompt
      };
    }
    return {
      continentName: mapping.continent,
      displayName: mapping.display,
      bounds: null,
      isCity: false,
      multiRegions: mapping.multiRegions || null
    };
  }

  // Check word by word
  const words = promptLower.split(/[\s,]+/);
  for (const word of words) {
    const originalWord = prompt.split(/[\s,]+/)[words.indexOf(word)];
    if (regionMap[word] || regionMap[originalWord]) {
      const mapping = regionMap[word] || regionMap[originalWord];
      if (typeof mapping === 'string') {
        return {
          continentName: mapping,
          displayName: originalWord || word
        };
      }
      return {
        continentName: mapping.continent,
        displayName: mapping.display,
        bounds: null,
        isCity: false,
        multiRegions: mapping.multiRegions || null
      };
    }
  }

  // Check country bounds data
  if (countryBoundsData) {
    for (const countryKey of Object.keys(countryBoundsData)) {
      const countryInfo = countryBoundsData[countryKey];
      if (!countryInfo || typeof countryInfo !== 'object') {
        continue;
      }

      const escapedCountryKey = countryKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const countryPatterns = [
        new RegExp(`(?:^|[\\s,\\.\\-\\(\\)\\[\\{])(${escapedCountryKey})(?=$|[\\s,\\.\\-\\)\\]\\}])`, 'i'),
        new RegExp(`באזור\\s*(${escapedCountryKey})`, 'i'),
        new RegExp(`ב-?(${escapedCountryKey})(?=$|[^\\p{L}\\p{N}])`, 'iu')
      ];

      let matchValue = null;
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

      const boundsSource = countryInfo.bounds && typeof countryInfo.bounds === 'object'
        ? countryInfo.bounds
        : countryInfo;

      if (
        typeof boundsSource.minLat === 'number' &&
        typeof boundsSource.maxLat === 'number' &&
        typeof boundsSource.minLng === 'number' &&
        typeof boundsSource.maxLng === 'number'
      ) {
        const regionMeta = regionMap[countryKey] || regionMap[countryKey.toLowerCase()] || null;
        return {
          continentName: (regionMeta && regionMeta.continent) || null,
          displayName: matchValue || countryKey,
          bounds: {
            minLat: boundsSource.minLat,
            maxLat: boundsSource.maxLat,
            minLng: boundsSource.minLng,
            maxLng: boundsSource.maxLng
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

  let locationName = null;
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
      const bounds = await getLocationBounds(locationName);
      if (bounds) {
        console.log(`✅ Found city/location bounds for "${locationName}"`);
        return {
          continentName: null,
          displayName: bounds.foundName || locationName,
          bounds,
          isCity: (bounds.type || '').toLowerCase().includes('city')
        };
      }
    } catch (err) {
      console.warn(`⚠️ Error geocoding "${locationName}":`, err.message);
    }
  }

  // Final fallback: try entire prompt
  if (prompt && prompt.trim()) {
    const trimmedPrompt = prompt.trim();
    console.log(`🌍 Final geocode attempt for prompt: "${trimmedPrompt}"`);
    try {
      const bounds = await getLocationBounds(trimmedPrompt);
      if (bounds) {
        console.log(`✅ Found bounds for prompt "${trimmedPrompt}" via geocode`);
        return {
          continentName: null,
          displayName: bounds.foundName || trimmedPrompt,
          bounds,
          isCity: (bounds.type || '').toLowerCase().includes('city')
        };
      }
    } catch (err) {
      console.warn(`⚠️ Final geocode attempt failed for "${trimmedPrompt}":`, err.message);
    }
  }

  console.log(`❌ No region/city found in prompt: "${prompt}"`);
  return null;
}

module.exports = {
  extractRequestedRegion
};

