const { getLocationInfo, getLocationBounds } = require('./geminiService');

const loadJson = (path) => {
  try {
    return require(path);
  } catch (err) {
    console.warn(`⚠️ Could not load ${path}:`, err.message);
    return null;
  }
};

const countryBoundsData = loadJson('../utils/countryBounds.json');
const cityBoundsData = loadJson('../utils/cityBounds.json');

function isLandLocation(description) {
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

async function extractRequestedRegion(prompt) {
  if (!prompt || typeof prompt !== 'string') return null;

  const promptLower = prompt.toLowerCase();
  console.log(`🔍 extractRequestedRegion called with: "${prompt}"`);

  const cityKeywords = {
    'תל אביב': true, 'tel aviv': true, 'תל-אביב': true,
    'ירושלים': true, 'jerusalem': true,
    'חיפה': true, 'haifa': true,
    'באר שבע': true, 'beer sheva': true, 'באר-שבע': true,
    'אילת': true, 'eilat': true,
    'נתניה': true, 'netanya': true,
    'פתח תקווה': true, 'petah tikva': true, 'פתח-תקווה': true,
    'ראשון לציון': true, 'rishon lezion': true, 'ראשון-לציון': true,
    'ניו יורק': true, 'new york': true, 'ny': true, 'nyc': true,
    "לוס אנג'לס": true, 'los angeles': true, 'la': true,
    'לונדון': true, 'london': true,
    'פריז': true, 'paris': true,
    'ברלין': true, 'berlin': true,
    'מדריד': true, 'madrid': true,
    'רומא': true, 'rome': true,
    'מילאנו': true, 'milan': true,
    'ברצלונה': true, 'barcelona': true,
    'אמסטרדם': true, 'amsterdam': true,
    'טוקיו': true, 'tokyo': true,
    'סיאול': true, 'seoul': true,
    "בייג'ינג": true, 'beijing': true, 'פקין': true,
    'שנגחאי': true, 'shanghai': true,
    'דובאי': true, 'dubai': true,
    'סינגפור': true, 'singapore': true,
    'הונג קונג': true, 'hong kong': true,
    'בנגקוק': true, 'bangkok': true,
    'איסטנבול': true, 'istanbul': true,
    'קהיר': true, 'cairo': true,
    'מומבאי': true, 'mumbai': true,
    'דלהי': true, 'delhi': true,
    'סידני': true, 'sydney': true,
    'מלבורן': true, 'melbourne': true,
    'טורונטו': true, 'toronto': true,
    'ונקובר': true, 'vancouver': true,
    'מכסיקו סיטי': true, 'mexico city': true,
    "ריו דה ז'נרו": true, 'rio de janeiro': true, 'rio': true,
    'סאו פאולו': true, 'sao paulo': true,
    'בואנוס איירס': true, 'buenos aires': true,
    'קייפטאון': true, 'cape town': true,
    'יוהנסבורג': true, 'johannesburg': true,
    'מוסקבה': true, 'moscow': true,
    'סנט פטרבורג': true, 'saint petersburg': true, 'st petersburg': true,
    'ורשה': true, 'warsaw': true,
    'פראג': true, 'prague': true,
    'בודפשט': true, 'budapest': true,
    'וינה': true, 'vienna': true,
    'ציריך': true, 'zurich': true,
    "ג'נבה": true, 'geneva': true,
    'בריסל': true, 'brussels': true,
    'אתונה': true, 'athens': true,
    'ליסבון': true, 'lisbon': true,
    'קופנהגן': true, 'copenhagen': true,
    'שטוקהולם': true, 'stockholm': true,
    'אוסלו': true, 'oslo': true,
    'הלסינקי': true, 'helsinki': true,
    'דבלין': true, 'dublin': true
  };

  let detectedCity = null;
  for (const cityName in cityKeywords) {
    const escapedCityName = cityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const cityPatterns = [
      new RegExp(`\\b${escapedCityName}\\b`, 'i'),
      new RegExp(`ב-?${escapedCityName}(?:[^א-תa-z]|$)`, 'i'),
      new RegExp(`באזור\\s*${escapedCityName}`, 'i'),
      new RegExp(`in\\s+${escapedCityName}`, 'i')
    ];

    if (cityPatterns.some(pattern => pattern.test(promptLower))) {
      console.log(`🏙️ Detected explicit city mention: "${cityName}" - prioritizing over countries`);
      detectedCity = cityName;
      break;
    }
  }

  if (detectedCity && cityBoundsData && cityBoundsData[detectedCity]) {
    return {
      continentName: null,
      displayName: detectedCity,
      bounds: cityBoundsData[detectedCity],
      isCity: true
    };
  }

  const regionMap = {
    'סלובניה': {continent: 'Southern Europe', display: 'סלובניה'},
    'slovenia': {continent: 'Southern Europe', display: 'Slovenia'},
    'סלובקיה': 'Eastern Europe',
    'slovakia': 'Eastern Europe',
    'פולין': 'Eastern Europe',
    'poland': 'Eastern Europe',
    'גרמניה': 'Western Europe',
    'germany': 'Western Europe',
    'צרפת': 'Western Europe',
    'france': 'Western Europe',
    'ספרד': 'Southern Europe',
    'spain': 'Southern Europe',
    'איטליה': 'Southern Europe',
    'italy': 'Southern Europe',
    'בריטניה': 'UK & Ireland',
    'britain': 'UK & Ireland',
    'uk': 'UK & Ireland',
    'אנגליה': 'UK & Ireland',
    'england': 'UK & Ireland',
    'שוודיה': 'Scandinavia',
    'sweden': 'Scandinavia',
    'נורווגיה': 'Scandinavia',
    'norway': 'Scandinavia',
    'דנמרק': 'Scandinavia',
    'denmark': 'Scandinavia',
    'פינלנד': 'Scandinavia',
    'finland': 'Scandinavia',
    'רוסיה': 'Eastern Europe',
    'russia': 'Eastern Europe',
    'טורקיה': 'Levant & Turkey',
    'turkey': 'Levant & Turkey',
    'יוון': 'Southern Europe',
    'greece': 'Southern Europe',
    'פורטוגל': 'Southern Europe',
    'portugal': 'Southern Europe',
    'הולנד': 'Western Europe',
    'netherlands': 'Western Europe',
    'בלגיה': 'Western Europe',
    'belgium': 'Western Europe',
    'שוויץ': 'Western Europe',
    'switzerland': 'Western Europe',
    'אוסטריה': 'Western Europe',
    'austria': 'Western Europe',
    'צ\'כיה': 'Eastern Europe',
    'czech': 'Eastern Europe',
    'צ\'ילה': 'Chile & Argentina',
    'chile': 'Chile & Argentina',
    'פרו': 'Andean Countries',
    'peru': 'Andean Countries',
    'קולומביה': 'Andean Countries',
    'colombia': 'Andean Countries',
    'מצרים': 'North Africa',
    'egypt': 'North Africa',
    'מרוקו': 'North Africa',
    'morocco': 'North Africa',
    'דרום אפריקה': 'Southern Africa',
    'south africa': 'Southern Africa',
    'ניגריה': 'West Africa',
    'nigeria': 'West Africa',
    'קניה': 'East Africa',
    'kenya': 'East Africa',
    'אוסטרליה': 'Australia',
    'australia': 'Australia',
    'ניו זילנד': 'New Zealand',
    'new zealand': 'New Zealand',
    'אירופה': {continent: 'MULTI_EUROPE', display: 'אירופה', multiRegions: ['Western Europe', 'Eastern Europe', 'Southern Europe', 'Scandinavia', 'UK & Ireland']},
    'europe': {continent: 'MULTI_EUROPE', display: 'Europe', multiRegions: ['Western Europe', 'Eastern Europe', 'Southern Europe', 'Scandinavia', 'UK & Ireland']},
    'אסיה': {continent: 'MULTI_ASIA', display: 'אסיה', multiRegions: ['China Mainland', 'Japan', 'Korea', 'Mainland Southeast Asia', 'India', 'Pakistan & Afghanistan']},
    'asia': {continent: 'MULTI_ASIA', display: 'Asia', multiRegions: ['China Mainland', 'Japan', 'Korea', 'Mainland Southeast Asia', 'India', 'Pakistan & Afghanistan']},
    'מזרח אסיה': {continent: 'MULTI_EAST_ASIA', display: 'מזרח אסיה', multiRegions: ['China Mainland', 'Japan', 'Korea']},
    'east asia': {continent: 'MULTI_EAST_ASIA', display: 'East Asia', multiRegions: ['China Mainland', 'Japan', 'Korea']},
    'דרום אסיה': {continent: 'India', display: 'דרום אסיה'},
    'south asia': {continent: 'India', display: 'South Asia'},
    'דרום מזרח אסיה': {continent: 'MULTI_SOUTHEAST_ASIA', display: 'דרום מזרח אסיה', multiRegions: ['Mainland Southeast Asia', 'Indonesia West', 'Philippines']},
    'southeast asia': {continent: 'MULTI_SOUTHEAST_ASIA', display: 'Southeast Asia', multiRegions: ['Mainland Southeast Asia', 'Indonesia West', 'Philippines']},
    'מזרח התיכון': {continent: 'MULTI_MIDDLE_EAST', display: 'מזרח התיכון', multiRegions: ['Levant & Turkey', 'Arabian Peninsula', 'Iran']},
    'middle east': {continent: 'MULTI_MIDDLE_EAST', display: 'Middle East', multiRegions: ['Levant & Turkey', 'Arabian Peninsula', 'Iran']},
    'אמריקה': {continent: 'MULTI_AMERICAS', display: 'אמריקה', multiRegions: ['Eastern USA', 'Western USA', 'Eastern Canada', 'Western Canada', 'Mexico', 'Brazil North', 'Brazil South', 'Chile & Argentina']},
    'america': {continent: 'MULTI_AMERICAS', display: 'America', multiRegions: ['Eastern USA', 'Western USA', 'Eastern Canada', 'Western Canada', 'Mexico', 'Brazil North', 'Brazil South', 'Chile & Argentina']},
    'צפון אמריקה': {continent: 'MULTI_NORTH_AMERICA', display: 'צפון אמריקה', multiRegions: ['Eastern USA', 'Western USA', 'Eastern Canada', 'Western Canada', 'Mexico']},
    'north america': {continent: 'MULTI_NORTH_AMERICA', display: 'North America', multiRegions: ['Eastern USA', 'Western USA', 'Eastern Canada', 'Western Canada', 'Mexico']},
    'דרום אמריקה': {continent: 'MULTI_SOUTH_AMERICA', display: 'דרום אמריקה', multiRegions: ['Brazil North', 'Brazil South', 'Andean Countries', 'Chile & Argentina']},
    'south america': {continent: 'MULTI_SOUTH_AMERICA', display: 'South America', multiRegions: ['Brazil North', 'Brazil South', 'Andean Countries', 'Chile & Argentina']},
    'אפריקה': {continent: 'MULTI_AFRICA', display: 'אפריקה', multiRegions: ['North Africa', 'West Africa', 'East Africa', 'Southern Africa']},
    'africa': {continent: 'MULTI_AFRICA', display: 'Africa', multiRegions: ['North Africa', 'West Africa', 'East Africa', 'Southern Africa']},
    'אוקיאניה': {continent: 'MULTI_OCEANIA', display: 'אוקיאניה', multiRegions: ['Australia', 'New Zealand']},
    'oceania': {continent: 'MULTI_OCEANIA', display: 'Oceania', multiRegions: ['Australia', 'New Zealand']}
  };

  if (regionMap[promptLower]) {
    const mapping = regionMap[promptLower];
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

  const words = promptLower.split(/[\s,]+/);
  for (const word of words) {
    if (regionMap[word]) {
      const mapping = regionMap[word];
      if (typeof mapping === 'string') {
        return {
          continentName: mapping,
          displayName: word
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

  if (countryBoundsData) {
    for (const countryKey of Object.keys(countryBoundsData)) {
      const regex = new RegExp(`\b${countryKey}\b`, 'i');
      if (regex.test(promptLower)) {
        return {
          continentName: regionMap[countryKey]?.continent || null,
          displayName: countryBoundsData[countryKey].display || countryBoundsData[countryKey].name || countryKey,
          bounds: countryBoundsData[countryKey].bounds || null,
          isCity: false
        };
      }
    }
  }

  // Fallback patterns using regionMap logic from route remain covered by loops above

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
          displayName: locationName,
          bounds,
          isCity: true
        };
      }
    } catch (err) {
      console.warn(`⚠️ Error geocoding "${locationName}":`, err.message);
    }
  }

  console.log(`❌ No region/city found in prompt: "${prompt}"`);
  return null;
}

const continents = [
  { name: 'Western Europe', minLat: 42, maxLat: 60, minLng: -5, maxLng: 15, weight: 2 },
  { name: 'Eastern Europe', minLat: 44, maxLat: 60, minLng: 15, maxLng: 40, weight: 2 },
  { name: 'Southern Europe', minLat: 36, maxLat: 46, minLng: -9, maxLng: 28, weight: 2 },
  { name: 'Scandinavia', minLat: 55, maxLat: 71, minLng: 5, maxLng: 31, weight: 1 },
  { name: 'UK & Ireland', minLat: 50, maxLat: 60, minLng: -10, maxLng: 2, weight: 1 },
  { name: 'China Mainland', minLat: 18, maxLat: 53, minLng: 73, maxLng: 135, weight: 3 },
  { name: 'Japan', minLat: 30, maxLat: 46, minLng: 129, maxLng: 146, weight: 1 },
  { name: 'Korea', minLat: 33, maxLat: 43, minLng: 124, maxLng: 131, weight: 1 },
  { name: 'Mainland Southeast Asia', minLat: 5, maxLat: 28, minLng: 92, maxLng: 109, weight: 2 },
  { name: 'Indonesia West', minLat: -11, maxLat: 6, minLng: 95, maxLng: 120, weight: 1 },
  { name: 'Philippines', minLat: 5, maxLat: 19, minLng: 117, maxLng: 127, weight: 1 },
  { name: 'India', minLat: 8, maxLat: 35, minLng: 68, maxLng: 97, weight: 2 },
  { name: 'Pakistan & Afghanistan', minLat: 24, maxLat: 38, minLng: 60, maxLng: 75, weight: 1 },
  { name: 'Levant & Turkey', minLat: 31, maxLat: 42, minLng: 26, maxLng: 45, weight: 1 },
  { name: 'Arabian Peninsula', minLat: 12, maxLat: 32, minLng: 34, maxLng: 60, weight: 1 },
  { name: 'Iran', minLat: 25, maxLat: 40, minLng: 44, maxLng: 63, weight: 1 },
  { name: 'Eastern USA', minLat: 25, maxLat: 50, minLng: -98, maxLng: -67, weight: 2 },
  { name: 'Western USA', minLat: 31, maxLat: 49, minLng: -125, maxLng: -102, weight: 2 },
  { name: 'Eastern Canada', minLat: 43, maxLat: 62, minLng: -95, maxLng: -52, weight: 1 },
  { name: 'Western Canada', minLat: 49, maxLat: 62, minLng: -140, maxLng: -95, weight: 1 },
  { name: 'Mexico', minLat: 14, maxLat: 32, minLng: -118, maxLng: -86, weight: 1 },
  { name: 'Central America', minLat: 7, maxLat: 18, minLng: -93, maxLng: -77, weight: 1 },
  { name: 'Brazil North', minLat: -10, maxLat: 5, minLng: -74, maxLng: -35, weight: 2 },
  { name: 'Brazil South', minLat: -34, maxLat: -10, minLng: -58, maxLng: -35, weight: 1 },
  { name: 'Andean Countries', minLat: -18, maxLat: 12, minLng: -81, maxLng: -66, weight: 1 },
  { name: 'Chile & Argentina', minLat: -55, maxLat: -22, minLng: -75, maxLng: -53, weight: 1 },
  { name: 'North Africa', minLat: 15, maxLat: 37, minLng: -17, maxLng: 52, weight: 2 },
  { name: 'West Africa', minLat: 4, maxLat: 20, minLng: -17, maxLng: 16, weight: 1 },
  { name: 'East Africa', minLat: -12, maxLat: 16, minLng: 22, maxLng: 51, weight: 1 },
  { name: 'Southern Africa', minLat: -35, maxLat: -15, minLng: 11, maxLng: 42, weight: 1 },
  { name: 'Australia', minLat: -44, maxLat: -10, minLng: 113, maxLng: 154, weight: 2 },
  { name: 'New Zealand', minLat: -47, maxLat: -34, minLng: 166, maxLng: 179, weight: 1 }
];

function buildLocationAckMessage(requestedRegion) {
  if (requestedRegion && requestedRegion.displayName) {
    return `🌍 קיבלתי! בוחר מיקום אקראי באזור ${requestedRegion.displayName}...`;
  }
  return '🌍 קיבלתי! בוחר מיקום אקראי על כדור הארץ...';
}

async function findRandomLocation({ requestedRegion, maxAttempts = 15 }) {
  let locationInfo = null;
  let attempts = 0;

  const hasSpecificBounds = requestedRegion && requestedRegion.bounds;

  let availableContinents = continents;

  if (requestedRegion) {
    const requestedRegionName = requestedRegion.continentName;
    const hasMultiRegions = requestedRegion.multiRegions && Array.isArray(requestedRegion.multiRegions);

    if (requestedRegionName && !hasSpecificBounds) {
      if (hasMultiRegions) {
        availableContinents = continents.filter(c => requestedRegion.multiRegions.includes(c.name));
        if (availableContinents.length === 0) {
          availableContinents = continents;
        }
      } else {
        availableContinents = continents.filter(c => c.name === requestedRegionName);
        if (availableContinents.length === 0) {
          availableContinents = continents;
        }
      }
    }
  }

  let useBoundsForGeneration = hasSpecificBounds;

  while (attempts < maxAttempts && !locationInfo) {
    attempts++;

    let latitude;
    let longitude;

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
    }

    if (!useBoundsForGeneration || !latitude || !longitude) {
      const totalWeight = availableContinents.reduce((sum, c) => sum + c.weight, 0) || 1;
      let randomWeight = Math.random() * totalWeight;
      let selectedContinent = availableContinents[0] || continents[0];

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

    const tempLocationInfo = await getLocationInfo(parseFloat(latitude), parseFloat(longitude));

    if (tempLocationInfo.success && tempLocationInfo.description) {
      if (isLandLocation(tempLocationInfo.description)) {
        locationInfo = { ...tempLocationInfo, latitude, longitude };
      }
    }
  }

  if (!locationInfo) {
    return {
      success: false,
      error: `לא הצלחתי למצוא מיקום תקין אחרי ${maxAttempts} ניסיונות`
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

async function getRandomLocationForPrompt(prompt) {
  const requestedRegion = await extractRequestedRegion(prompt || '');
  const ackMessage = buildLocationAckMessage(requestedRegion);
  const locationResult = await findRandomLocation({ requestedRegion });
  return {
    ...locationResult,
    ackMessage,
    requestedRegion
  };
}

module.exports = {
  isLandLocation,
  extractRequestedRegion,
  buildLocationAckMessage,
  findRandomLocation,
  getRandomLocationForPrompt
};
