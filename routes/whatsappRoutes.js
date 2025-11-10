const express = require('express');
const router = express.Router();
const { sendTextMessage, sendFileByUrl, downloadFile, getChatHistory, getMessage, sendPoll, sendLocation } = require('../services/greenApiService');
const { getStaticFileUrl } = require('../utils/urlUtils');
const { generateTextResponse: generateOpenAIResponse, generateImageForWhatsApp: generateOpenAIImage, editImageForWhatsApp: editOpenAIImage, generateVideoWithSoraForWhatsApp, generateVideoWithSoraFromImageForWhatsApp } = require('../services/openaiService');
const { generateTextResponse: generateGeminiResponse, generateImageForWhatsApp, editImageForWhatsApp, analyzeVideoWithText, generateVideoForWhatsApp, generateVideoFromImageForWhatsApp, generateChatSummary, parseMusicRequest, parseTextToSpeechRequest, translateText, generateCreativePoll, getLocationInfo } = require('../services/geminiService');
const { generateTextResponse: generateGrokResponse, generateImageForWhatsApp: generateGrokImage } = require('../services/grokService');
const { generateVideoFromImageForWhatsApp: generateKlingVideoFromImage, generateVideoFromVideoForWhatsApp: generateRunwayVideoFromVideo, generateVideoWithTextForWhatsApp: generateKlingVideoFromText } = require('../services/replicateService');
const { generateMusicWithLyrics } = require('../services/musicService');
const speechService = require('../services/speechService');
const { voiceService } = require('../services/voiceService');
const { audioConverterService } = require('../services/audioConverterService');
const { creativeAudioService } = require('../services/creativeAudioService');
const locationService = require('../services/locationService');
const conversationManager = require('../services/conversationManager');
const { routeToAgent } = require('../services/agentRouter');
const authStore = require('../store/authStore');
const groupAuthStore = require('../store/groupAuthStore');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Message deduplication cache - prevent processing duplicate messages
const processedMessages = new Set();

// Chat history limit for context retrieval
const CHAT_HISTORY_LIMIT = 30;

// Voice transcription and media authorization are managed through PostgreSQL database

// ════════════════════ SHARED REGEX PATTERNS (Avoid Duplication) ════════════════════

// Image edit detection patterns (Hebrew + English with ALL conjugations)
const IMAGE_EDIT_PATTERN = /שנה|תשנה|תשני|שני|ערוך|תערוך|ערכי|עדכן|תעדכן|תקן|תתקן|סדר|תסדר|סדרי|תסדרי|הוסף|תוסיף|תוסיפי|הוסיפי|מחק|תמחק|מחקי|תמחקי|הורד|תוריד|הורידי|תורידי|סיר|תסיר|סירי|תסירי|צייר|תצייר|ציירי|תצרי|הפוך|תהפוך|המר|תהמר|שפר|תשפר|שפרי|תשפרי|תחליף|החלף|החליפי|תחליפי|צור|תצור|צורי|תצרי|edit|change|modify|update|fix|correct|add|remove|delete|draw|paint|replace|swap|improve|enhance|create|make|transform/i;

// Implicit edit pattern (wearing/dressed patterns)
const IMAGE_IMPLICIT_EDIT_PATTERN = /^(לבוש|לבושה|לובש|לובשת|עם|כ(?!מה)|בתור)|^\b(wearing|dressed|with\s+a|as\s+a|in\s+a)\b/i;

// TTS keywords pattern (for detecting voice output requests)
const TTS_KEYWORDS_PATTERN = /אמור|אמרי|אמרו|תאמר|תאמרי|תאמרו|הקרא|הקראי|הקראו|תקרא|תקראי|תקראו|הקריא|הקריאי|הקריאו|תקריא|תקריאי|תקריאו|דבר|דברי|דברו|תדבר|תדברי|תדברו|בקול|קולית|\b(say|speak|tell|voice|read\s+aloud)\b/i;

// Translation keywords pattern (for detecting text-only translation)
const TRANSLATE_KEYWORDS_PATTERN = /תרגם|תרגמי|תרגמו|תתרגם|תתרגמי|תתרגמו|תרגום|\b(translate|translation)\b/i;

// Just transcription pattern (no other processing requested)
const JUST_TRANSCRIPTION_PATTERN = /^(תמלל|תמליל|transcribe|transcript)$/i;

// ═══════════════════════════════════════════════════════════════════════════════

// ════════════════════ CONSTANTS ════════════════════

// Minimum audio duration required for voice cloning (ElevenLabs requirement)
const MIN_DURATION_FOR_CLONING = 4.6; // seconds

// ElevenLabs TTS default settings
const ELEVENLABS_TTS_DEFAULTS = {
  model_id: 'eleven_v3',
  optimize_streaming_latency: 0,
  output_format: 'mp3_44100_128'
};

// Speech-to-text transcription default settings
const TRANSCRIPTION_DEFAULTS = {
  model: 'scribe_v1_experimental', // Excellent multilingual support
  language: null, // Auto-detect (Hebrew, English, Spanish, etc.)
  removeNoise: true,
  removeFiller: true,
  optimizeLatency: 0,
  format: 'ogg' // WhatsApp audio format
};

// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Clean sensitive/large data from objects for logging
 * Removes base64 thumbnails and truncates long strings
 */
function cleanForLogging(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  // Create a deep copy to avoid modifying the original
  const cleaned = JSON.parse(JSON.stringify(obj));
  
  function cleanObject(o) {
    for (const key in o) {
      if (o[key] && typeof o[key] === 'object') {
        cleanObject(o[key]);
      } else if (key === 'jpegThumbnail' || key === 'thumbnail') {
        // Replace base64 thumbnails with a short indicator
        if (typeof o[key] === 'string' && o[key].length > 100) {
          o[key] = `[base64 thumbnail: ${o[key].length} chars]`;
        }
      } else if (key === 'vcard' && typeof o[key] === 'string' && o[key].length > 200) {
        // Truncate long vCard fields (contact cards with base64 photos)
        o[key] = `[vCard: ${o[key].length} chars, starts with: ${o[key].substring(0, 100)}...]`;
      } else if ((key === 'downloadUrl' || key === 'url') && typeof o[key] === 'string' && o[key].length > 200) {
        // Truncate long URLs
        o[key] = `[URL: ${o[key].length} chars, starts with: ${o[key].substring(0, 80)}...]`;
      } else if (key === 'data' && typeof o[key] === 'string' && o[key].length > 200) {
        // Truncate long base64 data fields
        o[key] = `[base64 data: ${o[key].length} chars, starts with: ${o[key].substring(0, 50)}...]`;
      }
    }
  }
  
  cleanObject(cleaned);
  return cleaned;
}

/**
 * Check if a location description indicates land (not open water)
 * @param {string} description - Location description from Gemini
 * @returns {boolean} - true if land, false if open water
 */
function isLandLocation(description) {
  const descLower = description.toLowerCase();
  
  // POSITIVE INDICATORS: If any found, immediately accept as land
  // (e.g., "city by the sea" should be accepted)
  const landIndicators = [
    'עיר', 'כפר', 'ישוב', 'מדינה', 'רחוב', 'שכונה', 'אזור', 'מחוז', 'מדבר', 'הר', 'עמק', 'יער',
    'city', 'town', 'village', 'country', 'street', 'district', 'region', 'province', 
    'desert', 'mountain', 'valley', 'forest', 'park', 'road', 'highway', 'building',
    'neighborhood', 'settlement', 'capital', 'state', 'county', 'rural', 'urban', 'population'
  ];
  
  const hasLandIndicator = landIndicators.some(indicator => descLower.includes(indicator));
  
  if (hasLandIndicator) {
    return true; // Strong land indicator - accept!
  }
  
  // NEGATIVE INDICATORS: Only reject if OPEN WATER (not coastal areas)
  const openWaterKeywords = [
    'אוקיינוס', 'באוקיינוס', 'באמצע האוקיינוס', 'באמצע הים', 'בלב הים',
    'in the ocean', 'in the middle of the ocean', 'in the middle of the sea',
    'open water', 'open ocean', 'deep water', 'deep ocean', 'open sea',
    'atlantic ocean', 'pacific ocean', 'indian ocean', 'arctic ocean',
    'מים פתוחים', 'מים עמוקים', 'אין יבשה', 'no land'
  ];
  
  const isOpenWater = openWaterKeywords.some(keyword => descLower.includes(keyword));
  
  return !isOpenWater; // Accept unless it's open water
}

/**
 * Extract requested region/country/city from location prompt
 * Supports flexible Hebrew and English variations
 * IMPROVED: Better city detection, expanded country list, priority handling
 * @param {string} prompt - User prompt (e.g., "# שלח מיקום באזור סלובניה" or "שלח מיקום בתל אביב")
 * @returns {Promise<Object|null>} - {continentName: string, displayName: string, bounds: Object|null, isCity: boolean} or null if no match
 */
async function extractRequestedRegion(prompt) {
  if (!prompt || typeof prompt !== 'string') return null;
  
  const promptLower = prompt.toLowerCase();
  console.log(`🔍 extractRequestedRegion called with: "${prompt}"`);
  
  // Load country and city bounds from JSON files (loaded once, cached)
  let countryBounds = null;
  let cityBounds = null;
  try {
    countryBounds = require('../utils/countryBounds.json');
  } catch (err) {
    console.warn('⚠️ Could not load countryBounds.json:', err.message);
  }
  try {
    cityBounds = require('../utils/cityBounds.json');
  } catch (err) {
    console.warn('⚠️ Could not load cityBounds.json:', err.message);
  }
  
  // IMPORTANT: Check for specific city names FIRST (before checking countries)
  // This prevents "תל אביב" from being incorrectly matched as "אביב" (spring)
  const cityKeywords = {
    // Israel
    'תל אביב': true, 'tel aviv': true, 'תל-אביב': true,
    'ירושלים': true, 'jerusalem': true,
    'חיפה': true, 'haifa': true,
    'באר שבע': true, 'beer sheva': true, 'באר-שבע': true,
    'אילת': true, 'eilat': true,
    'נתניה': true, 'netanya': true,
    'פתח תקווה': true, 'petah tikva': true, 'פתח-תקווה': true,
    'ראשון לציון': true, 'rishon lezion': true, 'ראשון-לציון': true,
    // International major cities
    'ניו יורק': true, 'new york': true, 'ny': true, 'nyc': true,
    'לוס אנג\'לס': true, 'los angeles': true, 'la': true,
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
    'בייג\'ינג': true, 'beijing': true, 'פקין': true,
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
    'ריו דה ז\'נרו': true, 'rio de janeiro': true, 'rio': true,
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
    'ג\'נבה': true, 'geneva': true,
    'בריסל': true, 'brussels': true,
    'אתונה': true, 'athens': true,
    'ליסבון': true, 'lisbon': true,
    'קופנהגן': true, 'copenhagen': true,
    'שטוקהולם': true, 'stockholm': true,
    'אוסלו': true, 'oslo': true,
    'הלסינקי': true, 'helsinki': true,
    'דבלין': true, 'dublin': true
  };
  
  // Check if prompt explicitly mentions a known city (PRIORITY OVER COUNTRIES!)
  let detectedCity = null;
  for (const cityName in cityKeywords) {
    const escapedCityName = cityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Check for city with various patterns (more lenient for cities)
    const cityPatterns = [
      new RegExp(`\\b${escapedCityName}\\b`, 'i'),  // Standalone word
      new RegExp(`ב-?${escapedCityName}(?:[^א-תa-z]|$)`, 'i'),  // "בתל אביב"
      new RegExp(`באזור\\s*${escapedCityName}`, 'i'), // "באזור תל אביב"
      new RegExp(`in\\s+${escapedCityName}`, 'i')  // "in Tel Aviv"
    ];
    
    for (const pattern of cityPatterns) {
      if (pattern.test(promptLower)) {
        console.log(`🏙️ Detected explicit city mention: "${cityName}" - prioritizing over countries`);
        detectedCity = cityName;
        break;
      }
    }
    if (detectedCity) break;
  }
  
  // If a known city was detected, try to get its bounds (prefer hardcoded, then geocoding)
  if (detectedCity) {
    console.log(`🌍 Priority city detected: "${detectedCity}"`);
    
    // STEP 1: Try hardcoded city bounds first (most reliable)
    const detectedCityLower = detectedCity.toLowerCase();
    if (cityBounds && cityBounds[detectedCityLower]) {
      console.log(`✅ Found hardcoded bounds for city: "${detectedCity}"`);
      return {
        continentName: null, // Cities don't have continents
        displayName: detectedCity,
        bounds: cityBounds[detectedCityLower],
        isCity: true
      };
    }
    
    // STEP 2: Try geocoding as fallback
    try {
      const { getLocationBounds } = require('../services/geminiService');
      const geocodedBounds = await getLocationBounds(detectedCity);
      
      if (geocodedBounds) {
        console.log(`✅ Found geocoded bounds for priority city: "${detectedCity}"`);
        return {
          continentName: null, // Cities don't have continents
          displayName: geocodedBounds.foundName || detectedCity,
          bounds: geocodedBounds,
          isCity: true
        };
      } else {
        console.warn(`⚠️ Could not get bounds for known city "${detectedCity}", will try country search as fallback`);
      }
    } catch (err) {
      console.warn(`⚠️ Error geocoding known city "${detectedCity}":`, err.message);
      // Continue to country search as fallback
    }
  }
  
  // Map of countries/regions to continent names (supporting Hebrew and English)
  // Format: 'country_name': {continent: 'Continent Name', display: 'Display Name'}
  // Bounds are loaded from countryBounds.json and added automatically if available
  const regionMap = {
    // Europe
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
    'הונגריה': 'Eastern Europe',
    'hungary': 'Eastern Europe',
    'רומניה': 'Eastern Europe',
    'romania': 'Eastern Europe',
    'בולגריה': 'Eastern Europe',
    'bulgaria': 'Eastern Europe',
    'קרואטיה': 'Southern Europe',
    'croatia': 'Southern Europe',
    'סרביה': 'Eastern Europe',
    'serbia': 'Eastern Europe',
    'אירלנד': 'UK & Ireland',
    'ireland': 'UK & Ireland',
    
    // Asia
    'סין': 'China Mainland',
    'china': 'China Mainland',
    'יפן': 'Japan',
    'japan': 'Japan',
    'קוריאה': 'Korea',
    'korea': 'Korea',
    'דרום קוריאה': 'Korea',
    'south korea': 'Korea',
    'הודו': 'India',
    'india': 'India',
    'תאילנד': 'Mainland Southeast Asia',
    'thailand': 'Mainland Southeast Asia',
    'וייטנאם': 'Mainland Southeast Asia',
    'vietnam': 'Mainland Southeast Asia',
    'אינדונזיה': 'Indonesia West',
    'indonesia': 'Indonesia West',
    'פיליפינים': 'Philippines',
    'philippines': 'Philippines',
    'סינגפור': 'Mainland Southeast Asia',
    'singapore': 'Mainland Southeast Asia',
    'מלזיה': 'Mainland Southeast Asia',
    'malaysia': 'Mainland Southeast Asia',
    'פקיסטן': 'Pakistan & Afghanistan',
    'pakistan': 'Pakistan & Afghanistan',
    'אפגניסטן': 'Pakistan & Afghanistan',
    'afghanistan': 'Pakistan & Afghanistan',
    'קזחסטן': 'Pakistan & Afghanistan',
    'kazakhstan': 'Pakistan & Afghanistan',
    'קירגיזסטן': 'Pakistan & Afghanistan',
    'kyrgyzstan': 'Pakistan & Afghanistan',
    'טג׳יקיסטן': 'Pakistan & Afghanistan',
    'tajikistan': 'Pakistan & Afghanistan',
    'אוזבקיסטן': 'Pakistan & Afghanistan',
    'uzbekistan': 'Pakistan & Afghanistan',
    'טורקמניסטן': 'Pakistan & Afghanistan',
    'turkmenistan': 'Pakistan & Afghanistan',
    'מונגוליה': 'China Mainland',
    'mongolia': 'China Mainland',
    'נפאל': 'India',
    'nepal': 'India',
    'בנגלדש': 'India',
    'bangladesh': 'India',
    'סרי לנקה': 'India',
    'sri lanka': 'India',
    'מיאנמר': 'Mainland Southeast Asia',
    'myanmar': 'Mainland Southeast Asia',
    'בורמה': 'Mainland Southeast Asia',
    'burma': 'Mainland Southeast Asia',
    'לאוס': 'Mainland Southeast Asia',
    'laos': 'Mainland Southeast Asia',
    'קמבודיה': 'Mainland Southeast Asia',
    'cambodia': 'Mainland Southeast Asia',
    
    // Middle East
    'ישראל': 'Levant & Turkey',
    'israel': 'Levant & Turkey',
    'פלסטין': 'Levant & Turkey',
    'palestine': 'Levant & Turkey',
    'לבנון': 'Levant & Turkey',
    'lebanon': 'Levant & Turkey',
    'סוריה': 'Levant & Turkey',
    'syria': 'Levant & Turkey',
    'ירדן': 'Levant & Turkey',
    'jordan': 'Levant & Turkey',
    'ערב הסעודית': 'Arabian Peninsula',
    'saudi arabia': 'Arabian Peninsula',
    'איחוד האמירויות': 'Arabian Peninsula',
    'uae': 'Arabian Peninsula',
    'איראן': 'Iran',
    'iran': 'Iran',
    'עיראק': 'Levant & Turkey',
    'iraq': 'Levant & Turkey',
    
    // North America
    'ארצות הברית': 'Eastern USA',
    'usa': 'Eastern USA',
    'united states': 'Eastern USA',
    'ארה"ב': 'Eastern USA',
    'קנדה': 'Eastern Canada',
    'canada': 'Eastern Canada',
    'מקסיקו': 'Mexico',
    'mexico': 'Mexico',
    
    // South America
    'ברזיל': 'Brazil North',
    'brazil': 'Brazil North',
    'ארגנטינה': 'Chile & Argentina',
    'argentina': 'Chile & Argentina',
    'צ\'ילה': 'Chile & Argentina',
    'chile': 'Chile & Argentina',
    'פרו': 'Andean Countries',
    'peru': 'Andean Countries',
    'קולומביה': 'Andean Countries',
    'colombia': 'Andean Countries',
    
    // Africa
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
    
    // Oceania
    'אוסטרליה': 'Australia',
    'australia': 'Australia',
    'ניו זילנד': 'New Zealand',
    'new zealand': 'New Zealand',
    
    // Regional/Continental names - returns MULTIPLE continents when applicable
    // For broader geographic requests, we'll handle these specially to include multiple regions
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
  
  // Search for region keywords in prompt
  // Support patterns like: "באזור X", "ב-X", "X", "in X", "in region X", etc.
  for (const [regionName, regionData] of Object.entries(regionMap)) {
    // Escape special regex characters in region name
    const escapedRegionName = regionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Check for various patterns
    // Note: \b (word boundary) doesn't work well with Hebrew, so we use more flexible patterns
    const patterns = [
      // Pattern 1: "באזור X" or "באזורX" (with or without space)
      new RegExp(`באזור\\s*${escapedRegionName}(?:\\s|$|,|\\.|!|\\?|:|\\))`, 'i'),
      // Pattern 2: "ב-X" or "בX" (with or without dash)
      new RegExp(`ב-?${escapedRegionName}(?:\\s|$|,|\\.|!|\\?|:|\\))`, 'i'),
      // Pattern 3: "X" as standalone word (Hebrew - not part of another word)
      new RegExp(`(?:^|[^א-תa-z])${escapedRegionName}(?:[^א-תa-z]|$)`, 'i'),
      // Pattern 4: "in X" or "in region X" (English)
      new RegExp(`in\\s+(the\\s+)?(region\\s+of\\s+)?${escapedRegionName}(?:\\s|$|,|\\.|!|\\?|:|\\))`, 'i'),
      // Pattern 5: "in X" (English, simple)
      new RegExp(`in\\s+${escapedRegionName}(?:\\s|$|,|\\.|!|\\?|:|\\))`, 'i')
    ];
    
    // Test each pattern
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      try {
        if (pattern.test(promptLower)) {
          console.log(`✅ Pattern ${i + 1} matched: "${pattern.source}" for "${regionName}"`);
          console.log(`✅ Found region match: "${regionName}" → "${typeof regionData === 'string' ? regionData : regionData.continent}"`);
          // Support both old format (string) and new format (object)
          if (typeof regionData === 'string') {
            // Old format: use continent name as display name
            return {
              continentName: regionData,
              displayName: regionName.charAt(0).toUpperCase() + regionName.slice(1) // Capitalize first letter
            };
          } else {
            // New format: object with continent and display
            // Try to get bounds from countryBounds.json file
            const bounds = countryBounds && countryBounds[regionName] ? countryBounds[regionName] : null;
            
            // If this is a multi-region request (continent/large area), return the list
            if (regionData.multiRegions && Array.isArray(regionData.multiRegions)) {
              return {
                continentName: regionData.continent,
                displayName: regionData.display,
                bounds: bounds, // Usually null for broad regions
                multiRegions: regionData.multiRegions // List of specific regions to include
              };
            }
            
            return {
              continentName: regionData.continent,
              displayName: regionData.display,
              bounds: bounds // Include bounds if available for specific country
            };
          }
        }
      } catch (err) {
        // Skip invalid patterns
        console.warn(`⚠️ Pattern ${i + 1} failed for "${regionName}":`, err.message);
      }
    }
  }
  
  // If no country/region found, try to search for a city/location
  console.log(`🔍 No country/region found, trying to find city/location in prompt: "${prompt}"`);
  
  // Extract potential location name from prompt
  // Remove common command words first, but preserve location context
  let cleanPrompt = prompt
    .replace(/^(שלח|שלחי|שלחו|תשלח|תשלחי|תשלחו)\s+(מיקום|location)/i, '')
    .replace(/מיקום\s+(אקראי|random)/gi, '')
    .replace(/location\s+(random|אקראי)/gi, '')
    .replace(/שלח\s+(מיקום|location)/gi, '')
    .replace(/send\s+(location|מיקום)/gi, '')
    .trim();
  
  // Enhanced patterns for city/location extraction
  // Support: "באזור X", "ב-X", "X", "in X", "near X", etc.
  const locationPatterns = [
    /באזור\s+(.+?)(?:\s|$|,|\.|!|\?|:|\))/i,           // "באזור תל אביב"
    /באזור\s*(.+?)$/i,                                  // "באזור תל אביב" (end of string)
    /ב-?(.+?)(?:\s|$|,|\.|!|\?|:|\))/i,                 // "בתל אביב" or "ב-תל אביב"
    /ב-?(.+?)$/i,                                       // "בתל אביב" (end of string)
    /in\s+(?:the\s+)?(?:area\s+of\s+)?(.+?)(?:\s|$|,|\.|!|\?|:|\))/i,  // "in Barcelona" or "in the area of Paris"
    /in\s+(?:the\s+)?(.+?)$/i,                          // "in Barcelona" (end of string)
    /near\s+(.+?)(?:\s|$|,|\.|!|\?|:|\))/i,            // "near Tokyo"
    /near\s+(.+?)$/i,                                    // "near Tokyo" (end of string)
    /^([א-תa-z]+(?:\s+[א-תa-z]+)*)$/i                   // Just location name (Hebrew/English words only)
  ];
  
  // Words to skip (too common or not locations)
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
      // Skip if too short, is a skip word, or contains only numbers/special chars
      if (candidate.length >= 2 && 
          !skipWords.has(candidate.toLowerCase()) &&
          /[א-תa-z]/.test(candidate)) { // Must contain at least one letter
        locationName = candidate;
        console.log(`🌍 Extracted location name: "${locationName}" from pattern: ${pattern.source}`);
        break;
      }
    }
  }
  
  // If we found a potential location name, try to geocode it
  if (locationName) {
    console.log(`🌍 Attempting to geocode city/location: "${locationName}"`);
    try {
      const { getLocationBounds } = require('../services/geminiService');
      const cityBounds = await getLocationBounds(locationName);
      
      if (cityBounds) {
        console.log(`✅ Found city/location bounds for "${locationName}"`);
        return {
          continentName: null, // City doesn't have a continent
          displayName: locationName,
          bounds: cityBounds,
          isCity: true // Flag to indicate this is a city, not a country
        };
      }
    } catch (err) {
      console.warn(`⚠️ Error geocoding "${locationName}":`, err.message);
    }
  }
  
  console.log(`❌ No region/city found in prompt: "${prompt}"`);
  return null; // No region found
}
/**
 * Save last executed command for retry functionality (persisted to DB)
 * @param {string} chatId - Chat ID
 * @param {Object} decision - Router decision object
 * @param {Object} options - Additional options (imageUrl, videoUrl, normalized)
 */
async function saveLastCommand(chatId, decision, options = {}) {
  // Don't save retry, clarification, or denial commands
  if (['retry_last_command', 'ask_clarification', 'deny_unauthorized'].includes(decision.tool)) {
    return;
  }
  
  // Save to database for persistence across restarts
  await conversationManager.saveLastCommand(chatId, decision.tool, decision.args, {
    normalized: options.normalized,
    imageUrl: options.imageUrl,
    videoUrl: options.videoUrl,
    audioUrl: options.audioUrl
  });
}

// Provider override helper for retry (supports Hebrew/English variants)
function applyProviderOverride(additionalInstructions, currentDecision, context = {}) {
  if (!additionalInstructions || !additionalInstructions.trim()) return null;

  const text = additionalInstructions.toLowerCase();
  const wantsOpenAI = /openai|אוופנאי|אופן איי/i.test(additionalInstructions);
  const wantsGemini = /gemini|ג׳מיני|גמיני|גימיני/i.test(additionalInstructions);
  const wantsGrok   = /grok|גרוק/i.test(additionalInstructions);
  const wantsSora   = /sora|סורה/i.test(additionalInstructions);
  const wantsVeo    = /veo\s*3?(?:\.\d+)?|veo|ויו|וֶאו/i.test(additionalInstructions);
  const wantsKling  = /kling|קלינג/i.test(additionalInstructions);

  // Sora model variants
  const wantsSoraPro = /sora\s*2\s*pro|sora-2-pro|סורה\s*2\s*פרו|סורה-?2-?פרו/i.test(additionalInstructions);
  const wantsSora2   = /sora\s*2\b|sora-2\b|סורה\s*2|סורה-?2/i.test(additionalInstructions);

  // Decide new tool by media context and provider intent
  const { hasImage, hasVideo } = context;
  const originalTool = currentDecision?.tool || '';

  const cloneArgs = (args) => ({ ...(args || {}) });

  // Image-to-video intents with image present
  if (hasImage && (wantsSora || wantsVeo || wantsKling)) {
    if (wantsSora) {
      return {
        tool: 'sora_image_to_video',
        args: { ...cloneArgs(currentDecision.args), model: wantsSoraPro ? 'sora-2-pro' : (wantsSora2 ? 'sora-2' : (currentDecision.args?.model || 'sora-2')), service: 'openai' },
        reason: 'Retry override → Sora image-to-video'
      };
    }
    if (wantsVeo) {
      return {
        tool: 'veo3_image_to_video',
        args: { ...cloneArgs(currentDecision.args), model: currentDecision.args?.model || 'veo-3', service: 'gemini' },
        reason: 'Retry override → Veo image-to-video'
      };
    }
    if (wantsKling) {
      return {
        tool: 'kling_image_to_video',
        args: { ...cloneArgs(currentDecision.args), model: currentDecision.args?.model || 'kling-1', service: 'kling' },
        reason: 'Retry override → Kling image-to-video'
      };
    }
  }

  // Text-to-image
  if (!hasImage && /image|תמונה|צייר|ציור|צור.*תמונה|תייצר.*תמונה|תייצרי.*תמונה/i.test(additionalInstructions)) {
    if (wantsOpenAI) return { tool: 'openai_image', args: cloneArgs(currentDecision.args), reason: 'Retry override → OpenAI image' };
    if (wantsGemini) return { tool: 'gemini_image', args: cloneArgs(currentDecision.args), reason: 'Retry override → Gemini image' };
    if (wantsGrok)   return { tool: 'grok_image',   args: cloneArgs(currentDecision.args), reason: 'Retry override → Grok image' };
  }

  // Generic provider swap preserving tool family
  
  // Image editing
  if (originalTool.endsWith('_image_edit') || originalTool === 'image_edit') {
    if (wantsOpenAI) return { tool: 'image_edit', args: { ...cloneArgs(currentDecision.args), service: 'openai' }, reason: 'Retry override → OpenAI image edit' };
    if (wantsGemini) return { tool: 'image_edit', args: { ...cloneArgs(currentDecision.args), service: 'gemini' }, reason: 'Retry override → Gemini image edit' };
  }
  
  // Video editing
  if (originalTool.endsWith('_video_edit') || originalTool === 'video_to_video') {
    if (wantsSora) return { tool: 'video_to_video', args: { ...cloneArgs(currentDecision.args), service: 'openai' }, reason: 'Retry override → Sora video' };
    if (wantsVeo) return { tool: 'video_to_video', args: { ...cloneArgs(currentDecision.args), service: 'gemini' }, reason: 'Retry override → Veo video' };
    if (wantsKling) return { tool: 'video_to_video', args: { ...cloneArgs(currentDecision.args), service: 'kling' }, reason: 'Retry override → Kling video' };
  }
  
  // Image generation (not editing)
  if (originalTool.endsWith('_image') && !originalTool.endsWith('_image_edit')) {
    if (wantsOpenAI) return { tool: 'openai_image', args: cloneArgs(currentDecision.args), reason: 'Retry override → OpenAI image' };
    if (wantsGemini) return { tool: 'gemini_image', args: cloneArgs(currentDecision.args), reason: 'Retry override → Gemini image' };
    if (wantsGrok)   return { tool: 'grok_image',   args: cloneArgs(currentDecision.args), reason: 'Retry override → Grok image' };
  }

  // Image-to-video
  if (originalTool.endsWith('_image_to_video')) {
    if (wantsSora)   return { tool: 'sora_image_to_video',  args: { ...cloneArgs(currentDecision.args), model: wantsSoraPro ? 'sora-2-pro' : (wantsSora2 ? 'sora-2' : (currentDecision.args?.model || 'sora-2')) }, reason: 'Retry override → Sora image-to-video' };
    if (wantsVeo)    return { tool: 'veo3_image_to_video',  args: cloneArgs(currentDecision.args), reason: 'Retry override → Veo image-to-video' };
    if (wantsKling)  return { tool: 'kling_image_to_video', args: cloneArgs(currentDecision.args), reason: 'Retry override → Kling image-to-video' };
  }
  
  // Text-to-video
  if (originalTool.endsWith('_video') || originalTool === 'kling_text_to_video') {
    if (wantsSora)   return { tool: 'sora_video',  args: { ...cloneArgs(currentDecision.args), model: wantsSoraPro ? 'sora-2-pro' : (wantsSora2 ? 'sora-2' : (currentDecision.args?.model || 'sora-2')) }, reason: 'Retry override → Sora text-to-video' };
    if (wantsVeo)    return { tool: 'veo3_video',  args: cloneArgs(currentDecision.args), reason: 'Retry override → Veo text-to-video' };
    if (wantsKling)  return { tool: 'kling_text_to_video', args: cloneArgs(currentDecision.args), reason: 'Retry override → Kling text-to-video' };
  }

  // Chat provider swap
  if (originalTool.endsWith('_chat')) {
    if (wantsOpenAI) return { tool: 'openai_chat', args: cloneArgs(currentDecision.args), reason: 'Retry override → OpenAI chat' };
    if (wantsGemini) return { tool: 'gemini_chat', args: cloneArgs(currentDecision.args), reason: 'Retry override → Gemini chat' };
    if (wantsGrok)   return { tool: 'grok_chat',   args: cloneArgs(currentDecision.args), reason: 'Retry override → Grok chat' };
  }

  return null;
}

/**
 * Format chat history messages for including as context in prompts
 * @param {Array} messages - Array of messages from getChatHistory
 * @returns {string} - Formatted messages string
 */
function formatChatHistoryForContext(messages) {
  if (!messages || messages.length === 0) {
    return '';
  }
  
  let formattedMessages = '';
  messages.forEach((msg, index) => {
    const timestamp = new Date(msg.timestamp * 1000).toLocaleString('he-IL');
    
    // Use WhatsApp display name only (chatName), fallback to phone number
    let sender = 'משתמש';
    if (msg.chatName) {
      sender = msg.chatName;
    } else if (msg.sender) {
      // Extract phone number from sender ID (e.g., "972543995202@c.us" -> "972543995202")
      const phoneMatch = msg.sender.match(/^(\d+)@/);
      sender = phoneMatch ? phoneMatch[1] : msg.sender;
    }
    
    const messageText = msg.textMessage || msg.caption || '[מדיה]';
    
    formattedMessages += `${index + 1}. ${timestamp} - ${sender}: ${messageText}\n`;
  });
  
  return formattedMessages;
}

/**
 * Check if user is authorized for media creation (images, videos, music)
 * @param {Object} senderData - WhatsApp sender data from Green API
 * @returns {Promise<boolean>} - True if user is authorized
 */
async function isAuthorizedForMediaCreation(senderData) {
  return await authStore.isAuthorizedForMediaCreation(senderData);
}

/**
 * Check if user is authorized for group creation
 * @param {Object} senderData - WhatsApp sender data from Green API
 * @returns {Promise<boolean>} - True if user is authorized
 */
async function isAuthorizedForGroupCreation(senderData) {
  return await groupAuthStore.isAuthorizedForGroupCreation(senderData);
}

/**
 * Check if command requires media creation authorization
 * @param {string} commandType - Command type
 * @returns {boolean} - True if command requires authorization
 */
function requiresMediaAuthorization(commandType) {
  const mediaCommands = [
    'gemini_image',
    'openai_image',
    'grok_image', 
    'veo3_video',
    'kling_text_to_video',
    'kling_image_to_video',
    'veo3_image_to_video',
    'runway_video_to_video',
    'music_generation',
    'text_to_speech',
    'gemini_image_edit',
    'openai_image_edit'
  ];
  return mediaCommands.includes(commandType);
}

/**
 * Check if a command is an admin/management command (should only work from outgoing messages)
 * @param {string} commandType - Command type
 * @returns {boolean} - True if command is admin-only
 */
function isAdminCommand(commandType) {
  const adminCommands = [
    'include_in_transcription',
    'exclude_from_transcription',
    'add_media_authorization',
    'remove_media_authorization',
    'voice_transcription_status',
    'media_creation_status',
    'add_group_authorization',
    'remove_group_authorization',
    'group_creation_status',
    'clear_all_conversations',
    'sync_contacts',
    // New admin shortcuts without explicit name
    'add_media_authorization_current',
    'add_group_authorization_current',
    'include_in_transcription_current'
  ];
  return adminCommands.includes(commandType);
}

/**
 * Send unauthorized access message
 * @param {string} chatId - WhatsApp chat ID
 * @param {string} feature - Feature name (for logging)
 */
async function sendUnauthorizedMessage(chatId, feature) {
  const message = '🔒 סליחה, אין לך הרשאה להשתמש בתכונה זו. פנה למנהל המערכת.';
  await sendTextMessage(chatId, message);
  console.log(`🚫 Unauthorized access attempt to ${feature}`);
}

// Clean up old processed messages cache every 30 minutes
setInterval(() => {
  if (processedMessages.size > 1000) {
    processedMessages.clear();
    console.log('🧹 Cleared processed messages cache');
  }
  // Last commands are now persisted in DB, no need to clean up in-memory cache
}, 30 * 60 * 1000);

/**
 * Send immediate acknowledgment for long-running commands
 */
async function sendAck(chatId, command) {
  let ackMessage = '';
  
  switch (command.type) {
    // ═══════════════════ AGENT MODE ═══════════════════
    case 'agent_query':
      ackMessage = '🤖 קיבלתי! מעבד עם AI Agent מתקדם...';
      break;
      
    // ═══════════════════ CHAT ═══════════════════
    case 'gemini_chat':
      ackMessage = '💬 קיבלתי. מעבד עם Gemini...';
      break;
    case 'openai_chat':
      ackMessage = '💬 קיבלתי. מעבד עם OpenAI...';
      break;
    case 'grok_chat':
      ackMessage = '💬 קיבלתי. מעבד עם Grok...';
      break;
      
    // ═══════════════════ IMAGE GENERATION ═══════════════════
    case 'gemini_image':
      ackMessage = '🎨 קיבלתי! מייצר תמונה עם Gemini...';
      break;
    case 'openai_image':
      ackMessage = '🎨 קיבלתי! מייצר תמונה עם OpenAI...';
      break;
    case 'grok_image':
      ackMessage = '🎨 קיבלתי! מייצר תמונה עם Grok...';
      break;
      
    // ═══════════════════ VIDEO GENERATION ═══════════════════
    case 'veo3_video':
      ackMessage = '🎬 קיבלתי! יוצר וידאו עם Veo 3...';
      break;
    case 'sora_video':
      // Check if using Pro model from command.model
      ackMessage = command.model === 'sora-2-pro' 
        ? '🎬 קיבלתי! יוצר וידאו עם Sora 2 Pro...' 
        : '🎬 קיבלתי! יוצר וידאו עם Sora 2...';
      break;
    case 'kling_text_to_video':
      ackMessage = '🎬 קיבלתי! יוצר וידאו עם Kling AI...';
      break;
    case 'veo3_image_to_video':
      ackMessage = '🎬 יוצר וידאו עם Veo 3...';
      break;
    case 'sora_image_to_video':
      // Check if using Pro model from command.model
      ackMessage = command.model === 'sora-2-pro' 
        ? '🎬 יוצר וידאו עם Sora 2 Pro...' 
        : '🎬 יוצר וידאו עם Sora 2...';
      break;
    case 'kling_image_to_video':
      ackMessage = '🎬 יוצר וידאו עם Kling AI...';
      break;
    case 'runway_video_to_video':
      ackMessage = '🎬 עובד על הווידאו עם RunwayML Gen4...';
      break;
      
    // ═══════════════════ AUDIO & VOICE ═══════════════════
    case 'translate_text':
      ackMessage = '🌐 קיבלתי! מתרגם עם Gemini...';
      break;
    case 'text_to_speech':
      ackMessage = '🗣️ קיבלתי! מתרגם ומייצר דיבור עם ElevenLabs...';
      break;
    case 'voice_processing':
      ackMessage = '🎤 מעבד ומכין תשובה...';
      break;
    case 'voice_generation':
      ackMessage = '🎤 קיבלתי! מייצר קול עם ElevenLabs...';
      break;
    case 'creative_voice_processing':
      ackMessage = '🎨 מתחיל עיבוד יצירתי עם אפקטים ומוזיקה...';
      break;
    case 'voice_cloning_response':
      ackMessage = '🎤 קיבלתי! מתחיל שיבוט קול ויצירת תגובה...';
      break;
      
    // ═══════════════════ MUSIC ═══════════════════
    case 'music_generation':
      ackMessage = '🎵 קיבלתי! מתחיל יצירת שיר עם Suno AI... 🎶';
      break;
      
    // ═══════════════════ UTILITIES ═══════════════════
    case 'chat_summary':
      ackMessage = '📝 קיבלתי! מכין סיכום השיחה עם Gemini...';
      break;
    
    case 'retry_last_command':
      ackMessage = '🔄 קיבלתי! מריץ שוב את הפקודה האחרונה...';
      break;
    
    case 'create_poll':
      ackMessage = command.withRhyme === false 
        ? '📊 קיבלתי! יוצר סקר יצירתי...' 
        : '📊 קיבלתי! יוצר סקר יצירתי עם חרוזים...';
      break;
    
    case 'send_random_location':
      ackMessage = '🌍 קיבלתי! בוחר מיקום אקראי על כדור הארץ...';
      break;
      
    default:
      return; // No ACK needed for this command
  }
  
  try {
    await sendTextMessage(chatId, ackMessage);
    console.log(`✅ ACK sent for ${command.type}`);
  } catch (error) {
    console.error('❌ Error sending ACK:', error.message || error);
  }
}

/**
 * WhatsApp Green API Integration Routes
 */

/**
 * Webhook endpoint for receiving WhatsApp messages from Green API
 */
router.post('/webhook', async (req, res) => {
  try {
    // Security check: Verify webhook token
    const token = req.headers['authorization']?.replace('Bearer ', '') ||
                  req.query.token || 
                  req.body.token;
    
    const expectedToken = process.env.GREEN_API_WEBHOOK_TOKEN;
    
    if (!expectedToken) {
      console.error('❌ GREEN_API_WEBHOOK_TOKEN not configured in environment');
      return res.status(500).json({ error: 'Webhook token not configured' });
    }
    
    if (token !== expectedToken) {
      console.error('❌ Unauthorized webhook request - invalid token');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const webhookData = req.body;
    
    // Log full webhook payload for debugging
    console.log(`📱 Green API webhook: ${webhookData.typeWebhook || 'unknown'} | Type: ${webhookData.messageData?.typeMessage || 'N/A'}`);
    
    // TEMPORARY DEBUG: Log full payload to see what we're missing
    if (webhookData.messageData?.typeMessage) {
      console.log('🔍 FULL WEBHOOK PAYLOAD:', JSON.stringify(webhookData, null, 2));
    }

    // Handle different webhook types asynchronously
    if (webhookData.typeWebhook === 'incomingMessageReceived') {
      // Process in background - don't await
      handleIncomingMessage(webhookData).catch(error => {
        console.error('❌ Error in async webhook processing:', error.message || error);
      });
    } else if (webhookData.typeWebhook === 'outgoingMessageReceived') {
      // Process outgoing messages (commands sent by you)
      handleOutgoingMessage(webhookData).catch(error => {
        console.error('❌ Error in async outgoing message processing:', error.message || error);
      });
    }

    // Return 200 OK immediately
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('❌ Error processing webhook:', error.message || error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Handle quoted (replied) messages
 * Merges quoted message content with current message prompt
 */
async function handleQuotedMessage(quotedMessage, currentPrompt, chatId) {
  try {
    console.log(`🔗 Processing quoted message: ${quotedMessage.stanzaId}`);
    
    // Extract quoted message type and content
    const quotedType = quotedMessage.typeMessage;
    
    // For text messages, combine both texts
    if (quotedType === 'textMessage' || quotedType === 'extendedTextMessage') {
      const quotedText = quotedMessage.textMessage || '';
      const combinedPrompt = `${quotedText}\n\n${currentPrompt}`;
      console.log(`📝 Combined text prompt: ${combinedPrompt.substring(0, 100)}...`);
      return {
        hasImage: false,
        hasVideo: false,
        prompt: combinedPrompt,
        imageUrl: null,
        videoUrl: null
      };
    }
    
    // For media messages (image/video/audio/sticker), fetch the original message to get downloadUrl
    if (quotedType === 'imageMessage' || quotedType === 'videoMessage' || quotedType === 'audioMessage' || quotedType === 'stickerMessage') {
      console.log(`📸 Quoted ${quotedType}, fetching original message...`);
      
      // getMessage returns the full message with proper downloadUrl
      const originalMessage = await getMessage(chatId, quotedMessage.stanzaId);
      
      if (!originalMessage) {
        throw new Error('Failed to fetch quoted message');
      }
      
      // Extract download URL from the original message
      // Try multiple possible locations in the response structure
      let downloadUrl = null;
      
      if (quotedType === 'imageMessage' || quotedType === 'stickerMessage') {
        downloadUrl = originalMessage.downloadUrl || 
                     originalMessage.fileMessageData?.downloadUrl || 
                     originalMessage.imageMessageData?.downloadUrl ||
                     originalMessage.stickerMessageData?.downloadUrl ||
                     originalMessage.messageData?.fileMessageData?.downloadUrl ||
                     originalMessage.messageData?.imageMessageData?.downloadUrl ||
                     originalMessage.messageData?.stickerMessageData?.downloadUrl;
      } else if (quotedType === 'videoMessage') {
        downloadUrl = originalMessage.downloadUrl || 
                     originalMessage.fileMessageData?.downloadUrl || 
                     originalMessage.videoMessageData?.downloadUrl ||
                     originalMessage.messageData?.fileMessageData?.downloadUrl ||
                     originalMessage.messageData?.videoMessageData?.downloadUrl;
      } else if (quotedType === 'audioMessage') {
        downloadUrl = originalMessage.downloadUrl || 
                     originalMessage.fileMessageData?.downloadUrl || 
                     originalMessage.audioMessageData?.downloadUrl ||
                     originalMessage.messageData?.fileMessageData?.downloadUrl ||
                     originalMessage.messageData?.audioMessageData?.downloadUrl;
      }
      
      if (!downloadUrl) {
        console.log('⚠️ No downloadUrl found in originalMessage structure, trying quotedMessage directly...');
        // Fallback: try to get downloadUrl from quotedMessage itself (for outgoing messages)
        if (quotedType === 'imageMessage' || quotedType === 'stickerMessage') {
          downloadUrl = quotedMessage.downloadUrl || 
                       quotedMessage.fileMessageData?.downloadUrl || 
                       quotedMessage.imageMessageData?.downloadUrl ||
                       quotedMessage.stickerMessageData?.downloadUrl;
        } else if (quotedType === 'videoMessage') {
          downloadUrl = quotedMessage.downloadUrl || 
                       quotedMessage.fileMessageData?.downloadUrl || 
                       quotedMessage.videoMessageData?.downloadUrl;
        } else if (quotedType === 'audioMessage') {
          downloadUrl = quotedMessage.downloadUrl || 
                       quotedMessage.fileMessageData?.downloadUrl || 
                       quotedMessage.audioMessageData?.downloadUrl;
        }
        
        if (!downloadUrl) {
          console.log(`⚠️ No downloadUrl found for quoted ${quotedType} in getMessage or quotedMessage`);
          throw new Error(`No downloadUrl found for quoted ${quotedType}. Cannot process this quoted media.`);
        }
        console.log(`✅ Found downloadUrl in quotedMessage (fallback)`);
      }
      
      console.log(`✅ Found downloadUrl for quoted ${quotedType}`);
      
      // Extract caption from media message (if exists)
      // Caption can be directly on quotedMessage or nested in fileMessageData/imageMessageData
      let originalCaption = null;
      if (quotedType === 'imageMessage' || quotedType === 'stickerMessage') {
        originalCaption = quotedMessage.caption || quotedMessage.fileMessageData?.caption || quotedMessage.imageMessageData?.caption;
      } else if (quotedType === 'videoMessage') {
        originalCaption = quotedMessage.caption || quotedMessage.fileMessageData?.caption || quotedMessage.videoMessageData?.caption;
      }
      
      console.log(`📝 [handleQuotedMessage] Original caption found: "${originalCaption}"`);
      console.log(`📝 [handleQuotedMessage] Current prompt (additional): "${currentPrompt}"`);
      
      // If there's a caption with a command (starts with #), merge it with additional instructions
      let finalPrompt = currentPrompt;
      if (originalCaption && /^#\s+/.test(originalCaption.trim())) {
        // Remove # prefix from original caption
        const cleanCaption = originalCaption.trim().replace(/^#\s+/, '');
        // If there are additional instructions, append them
        if (currentPrompt && currentPrompt.trim()) {
          finalPrompt = `${cleanCaption}, ${currentPrompt}`;
          console.log(`🔗 Merged caption with additional instructions: "${finalPrompt.substring(0, 100)}..."`);
        } else {
          finalPrompt = cleanCaption;
        }
      }
      
      // Return the URL directly - let the handler functions download when needed
      return {
        hasImage: quotedType === 'imageMessage' || quotedType === 'stickerMessage',
        hasVideo: quotedType === 'videoMessage',
        hasAudio: quotedType === 'audioMessage',
        prompt: finalPrompt, // Use merged prompt (original caption + additional instructions)
        imageUrl: (quotedType === 'imageMessage' || quotedType === 'stickerMessage') ? downloadUrl : null,
        videoUrl: quotedType === 'videoMessage' ? downloadUrl : null,
        audioUrl: quotedType === 'audioMessage' ? downloadUrl : null
      };
    }
    
    // For other types, just use current prompt
    console.log(`⚠️ Unsupported quoted message type: ${quotedType}, using current prompt only`);
    return {
      hasImage: false,
      hasVideo: false,
      hasAudio: false,
      prompt: currentPrompt,
      imageUrl: null,
      videoUrl: null,
      audioUrl: null
    };
    
  } catch (error) {
    console.error('❌ Error handling quoted message:', error.message);
    
    // If it's a downloadUrl error for bot's own messages, return a clear error
    if (error.message.includes('Cannot process media from bot')) {
      return {
        hasImage: false,
        hasVideo: false,
        hasAudio: false,
        prompt: currentPrompt,
        imageUrl: null,
        videoUrl: null,
        audioUrl: null,
        error: '⚠️ לא יכול לעבד תמונות/וידאו/אודיו שהבוט שלח. שלח את המדיה מחדש או צטט הודעה ממשתמש אחר.'
      };
    }
    
    // For other errors, fallback to current prompt only
    return {
      hasImage: false,
      hasVideo: false,
      hasAudio: false,
      prompt: currentPrompt,
      imageUrl: null,
      videoUrl: null,
      audioUrl: null
    };
  }
}
/**
 * Handle incoming WhatsApp message
 */
async function handleIncomingMessage(webhookData) {
  try {
    const messageData = webhookData.messageData;
    const senderData = webhookData.senderData;
    
    // Extract message ID for deduplication
    let messageId = webhookData.idMessage;
    
    // For edited messages, append suffix to ensure they're processed even if original was processed
    if (messageData.typeMessage === 'editedMessage') {
      messageId = `${messageId}_edited_${Date.now()}`;
      console.log(`✏️ Edited message - using unique ID for reprocessing: ${messageId}`);
    }
    
    // Check if we already processed this message
    if (processedMessages.has(messageId)) {
      console.log(`🔄 Duplicate message detected, skipping: ${messageId}`);
      return;
    }
    
    // Mark message as processed
    processedMessages.add(messageId);
    
    const chatId = senderData.chatId;
    const senderId = senderData.sender;
    const senderName = senderData.senderName || senderId;
    const senderContactName = senderData.senderContactName || "";
    const chatName = senderData.chatName || "";
    
    // Handle text messages (regular, extended, quoted, and edited)
    let messageText = null;
    
    if (messageData.typeMessage === 'textMessage') {
      messageText = messageData.textMessageData?.textMessage;
    } else if (messageData.typeMessage === 'extendedTextMessage') {
      messageText = messageData.extendedTextMessageData?.text;
    } else if (messageData.typeMessage === 'quotedMessage') {
      // When replying to a message, the text is in extendedTextMessageData
      messageText = messageData.extendedTextMessageData?.text;
      // BUT: If this is actually an image/video/sticker with caption (not a reply), extract the caption
      if (!messageText) {
        messageText = messageData.fileMessageData?.caption || 
                     messageData.imageMessageData?.caption || 
                     messageData.videoMessageData?.caption ||
                     messageData.stickerMessageData?.caption;
      }
    } else if (messageData.typeMessage === 'editedMessage') {
      // Handle edited messages - treat them as regular messages
      messageText = messageData.editedMessageData?.textMessage;
      console.log(`✏️ Edited message detected: "${messageText}"`);
    }
    
    // Enhanced logging for incoming messages
    console.log(`📱 Incoming from ${senderName} | Type: ${messageData.typeMessage}${messageData.typeMessage === 'editedMessage' ? ' ✏️' : ''}`);
    if (messageText) {
      console.log(`   Text: ${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}`);
    }
    if (messageData.typeMessage === 'imageMessage') {
      const caption = messageData.fileMessageData?.caption || messageData.imageMessageData?.caption;
      console.log(`   Image Caption: ${caption || 'N/A'}`);
    }
    if (messageData.typeMessage === 'stickerMessage') {
      const caption = messageData.fileMessageData?.caption;
      console.log(`   Sticker Caption: ${caption || 'N/A'} (treating as image)`);
    }
    if (messageData.typeMessage === 'videoMessage') {
      const caption = messageData.fileMessageData?.caption || messageData.videoMessageData?.caption;
      console.log(`   Video Caption: ${caption || 'N/A'}`);
    }
    if (messageData.typeMessage === 'quotedMessage' && messageData.quotedMessage) {
      console.log(`   Quoted Message Type: ${messageData.quotedMessage.typeMessage}`);
      if (messageData.quotedMessage.textMessage) {
        console.log(`   Quoted Text: ${messageData.quotedMessage.textMessage.substring(0, 50)}...`);
      }
      if (messageData.quotedMessage.caption) {
        console.log(`   Quoted Caption: ${messageData.quotedMessage.caption.substring(0, 50)}...`);
      }
    }
    
    // Unified intent router for commands that start with "# "
    if (messageText && /^#\s+/.test(messageText.trim())) {
      try {
        // Extract the prompt (remove "# " prefix if exists)
        // For edited messages, # might be removed by WhatsApp/Green API
        const basePrompt = messageText.trim().replace(/^#\s+/, '').trim();
        
        // Check if this is a quoted/replied message
        // Only process quotedMessage if typeMessage is 'quotedMessage' (actual reply)
        // Don't process if it's just extendedTextMessage with leftover quotedMessage metadata
        const quotedMessage = messageData.quotedMessage;
        
        // IMPORTANT: Green API sends images/videos with captions as quotedMessage, but they're NOT actual quotes!
        // Check if this is a REAL quote (reply) or just a media message with caption
        // Logic:
        // - If caption exists AND matches/starts with the text → It's a NEW media message (not a quote)
        // - If caption doesn't exist OR doesn't match → It's a REAL quote
        const quotedCaption = quotedMessage?.caption;
        const extractedText = messageData.extendedTextMessageData?.text; // Don't shadow messageText!
        // Check if caption matches text (exact match OR caption starts with text, covering "# מה זה..." case)
        const captionMatchesText = quotedCaption && extractedText && 
                                  (quotedCaption === extractedText || 
                                   quotedCaption.startsWith(extractedText) ||
                                   extractedText.startsWith(quotedCaption));
        
        const isActualQuote = messageData.typeMessage === 'quotedMessage' && 
                             quotedMessage && 
                             quotedMessage.stanzaId &&
                             extractedText &&
                             !captionMatchesText; // It's a quote if text doesn't match caption
        
        let finalPrompt = basePrompt;
        let hasImage = messageData.typeMessage === 'imageMessage' || messageData.typeMessage === 'stickerMessage';
        let hasVideo = messageData.typeMessage === 'videoMessage';
        let hasAudio = messageData.typeMessage === 'audioMessage';
        let imageUrl = null;
        let videoUrl = null;
        let audioUrl = null;
        
        if (isActualQuote) {
          console.log(`🔗 Detected quoted message with stanzaId: ${quotedMessage.stanzaId}`);
          
          // Handle quoted message - merge content
          const quotedResult = await handleQuotedMessage(quotedMessage, basePrompt, chatId);
          
          // Check if there was an error processing the quoted message
          if (quotedResult.error) {
            await sendTextMessage(chatId, quotedResult.error);
            return;
          }
          
          finalPrompt = quotedResult.prompt;
          hasImage = quotedResult.hasImage;
          hasVideo = quotedResult.hasVideo;
          hasAudio = quotedResult.hasAudio;
          imageUrl = quotedResult.imageUrl;
          videoUrl = quotedResult.videoUrl;
          audioUrl = quotedResult.audioUrl;
        } else if (messageData.typeMessage === 'quotedMessage' && quotedMessage) {
          // This is a media message (image/video) with caption, NOT an actual quote
          // Extract downloadUrl from the message itself
          console.log(`📸 Media message with caption (not a quote) - Type: ${quotedMessage.typeMessage || 'unknown'}`);
          
          if (quotedMessage.typeMessage === 'imageMessage' || quotedMessage.typeMessage === 'stickerMessage') {
            hasImage = true;
            // Try all possible locations for downloadUrl
            imageUrl = messageData.downloadUrl || 
                      messageData.fileMessageData?.downloadUrl || 
                      messageData.imageMessageData?.downloadUrl ||
                      messageData.stickerMessageData?.downloadUrl ||
                      quotedMessage.downloadUrl ||
                      quotedMessage.fileMessageData?.downloadUrl ||
                      quotedMessage.imageMessageData?.downloadUrl ||
                      quotedMessage.stickerMessageData?.downloadUrl;
            
            // If still not found, try getMessage to fetch the current message's downloadUrl
            if (!imageUrl) {
              console.log('⚠️ downloadUrl not found in webhook, fetching from Green API...');
              try {
                const currentMessageId = webhookData.idMessage;
                const originalMessage = await greenApiService.getMessage(chatId, currentMessageId);
                imageUrl = originalMessage?.downloadUrl || 
                          originalMessage?.fileMessageData?.downloadUrl || 
                          originalMessage?.imageMessageData?.downloadUrl;
                console.log(`✅ downloadUrl fetched from getMessage: ${imageUrl ? 'found' : 'still NOT FOUND'}`);
              } catch (err) {
                console.log(`❌ Failed to fetch downloadUrl via getMessage: ${err.message}`);
              }
            }
            console.log(`📸 Image with caption detected, final downloadUrl: ${imageUrl ? 'found' : 'NOT FOUND'}`);
          } else if (quotedMessage.typeMessage === 'videoMessage') {
            hasVideo = true;
            videoUrl = messageData.downloadUrl || 
                      messageData.fileMessageData?.downloadUrl || 
                      messageData.videoMessageData?.downloadUrl ||
                      quotedMessage.downloadUrl ||
                      quotedMessage.fileMessageData?.downloadUrl ||
                      quotedMessage.videoMessageData?.downloadUrl;
            
            // If still not found, try getMessage to fetch the current message's downloadUrl
            if (!videoUrl) {
              console.log('⚠️ Video downloadUrl not found in webhook, fetching from Green API...');
              try {
                const currentMessageId = webhookData.idMessage;
                const originalMessage = await greenApiService.getMessage(chatId, currentMessageId);
                videoUrl = originalMessage?.downloadUrl || 
                          originalMessage?.fileMessageData?.downloadUrl || 
                          originalMessage?.videoMessageData?.downloadUrl;
                console.log(`✅ Video downloadUrl fetched from getMessage: ${videoUrl ? 'found' : 'still NOT FOUND'}`);
              } catch (err) {
                console.log(`❌ Failed to fetch video downloadUrl via getMessage: ${err.message}`);
              }
            }
            console.log(`🎥 Video with caption detected, final downloadUrl: ${videoUrl ? 'found' : 'NOT FOUND'}`);
          }
        }
        
        // Prepare quoted context for Agent (if quoted message exists)
        let quotedContext = null;
        if (isActualQuote && quotedMessage) {
          quotedContext = {
            type: quotedMessage.typeMessage || 'unknown',
            text: quotedMessage.textMessage || quotedMessage.caption || '',
            hasImage: quotedMessage.typeMessage === 'imageMessage' || quotedMessage.typeMessage === 'stickerMessage',
            hasVideo: quotedMessage.typeMessage === 'videoMessage',
            hasAudio: quotedMessage.typeMessage === 'audioMessage',
            audioUrl: audioUrl || null, // Include audio URL if available
            stanzaId: quotedMessage.stanzaId
          };
        }
        
        const normalized = {
          userText: `# ${finalPrompt}`, // Add back the # prefix for router
          hasImage: hasImage,
          hasVideo: hasVideo,
          hasAudio: hasAudio,
          quotedContext: quotedContext, // 🆕 Quoted message info for Agent
          chatType: chatId && chatId.endsWith('@g.us') ? 'group' : chatId && chatId.endsWith('@c.us') ? 'private' : 'unknown',
          language: 'he',
          authorizations: {
            media_creation: await isAuthorizedForMediaCreation({ senderContactName, chatName, senderName, chatId }),
            // group_creation and voice_allowed will be checked only when needed (lazy evaluation)
            group_creation: null,
            voice_allowed: null
          },
          // Pass sender data for lazy authorization checks
          senderData: { senderContactName, chatName, senderName, chatId, senderId }
        };

        // ═══════════════════ AGENT MODE (Gemini Function Calling) ═══════════════════
        // All requests are routed directly to the Agent for intelligent tool selection
        console.log('🤖 [AGENT] Processing request with Gemini Function Calling');
        
        try {
            // 🧠 CRITICAL: Save user message to conversation history BEFORE processing
            // This ensures continuity and allows the bot to see the full conversation
            await conversationManager.addMessage(chatId, 'user', normalized.text || userText);
            console.log(`💾 [Agent] Saved user message to conversation history`);
            
            const agentResult = await routeToAgent(normalized, chatId);
            
            if (agentResult.success) {
              // Send any generated media (image/video/audio/poll) with captions
              let mediaSent = false;
              
              if (agentResult.imageUrl) {
                console.log(`📸 [Pilot Agent] Sending generated image: ${agentResult.imageUrl}`);
                // Images support captions - use them!
                // Clean the caption: remove URLs, markdown links, and technical markers
                let caption = agentResult.imageCaption || agentResult.text || '';
                caption = caption
                  .replace(/\[.*?\]\(https?:\/\/[^\)]+\)/g, '') // Remove markdown links
                  .replace(/https?:\/\/[^\s]+/gi, '') // Remove plain URLs
                  .replace(/\[image\]/gi, '') // Remove [image] markers
                  .replace(/\[video\]/gi, '') // Remove [video] markers
                  .replace(/\[audio\]/gi, '') // Remove [audio] markers
                  .replace(/\[תמונה\]/gi, '') // Remove [תמונה] markers
                  .replace(/\[וידאו\]/gi, '') // Remove [וידאו] markers
                  .replace(/\[אודיו\]/gi, '') // Remove [אודיו] markers
                  .replace(/התמונה.*?נוצרה בהצלחה!/gi, '') // Remove success messages
                  .replace(/הוידאו.*?נוצר בהצלחה!/gi, '')
                  .replace(/✅/g, '')
                  .trim();
                
                await sendFileByUrl(chatId, agentResult.imageUrl, `agent_image_${Date.now()}.png`, caption);
                mediaSent = true;
              }
              
              if (agentResult.videoUrl) {
                console.log(`🎬 [Pilot Agent] Sending generated video: ${agentResult.videoUrl}`);
                // Videos don't support captions well - send as file, text separately
                await sendFileByUrl(chatId, agentResult.videoUrl, `agent_video_${Date.now()}.mp4`, '');
                mediaSent = true;
                
                // If there's meaningful text (description/revised prompt), send it separately
                if (agentResult.text && agentResult.text.trim()) {
                  let videoDescription = agentResult.text
                    .replace(/https?:\/\/[^\s]+/gi, '') // Remove URLs
                    .replace(/\[image\]/gi, '') // Remove [image] markers
                    .replace(/\[video\]/gi, '') // Remove [video] markers
                    .replace(/\[audio\]/gi, '') // Remove [audio] markers
                    .replace(/\[תמונה\]/gi, '') // Remove [תמונה] markers
                    .replace(/\[וידאו\]/gi, '') // Remove [וידאו] markers
                    .replace(/\[אודיו\]/gi, '') // Remove [אודיו] markers
                    .trim();
                  if (videoDescription && videoDescription.length > 2) {
                    await sendTextMessage(chatId, videoDescription);
                  }
                }
              }
              
              if (agentResult.audioUrl) {
                console.log(`🎵 [Pilot Agent] Sending generated audio: ${agentResult.audioUrl}`);
                // Audio doesn't support captions - send as file only
                const fullAudioUrl = agentResult.audioUrl.startsWith('http') 
                  ? agentResult.audioUrl 
                  : getStaticFileUrl(agentResult.audioUrl.replace('/static/', ''));
                await sendFileByUrl(chatId, fullAudioUrl, `agent_audio_${Date.now()}.mp3`, '');
                mediaSent = true;
                
                // For audio files (TTS/translate_and_speak), don't send text - the audio IS the response
                // No need for textual descriptions like "הנה הקלטה קולית..."
              }
              
              if (agentResult.poll) {
                console.log(`📊 [Pilot Agent] Sending poll: ${agentResult.poll.question}`);
                // Convert options to Green API format
                const pollOptions = agentResult.poll.options.map(opt => ({ optionName: opt }));
                await sendPoll(chatId, agentResult.poll.question, pollOptions, false);
                mediaSent = true;
              }
              
              if (agentResult.latitude && agentResult.longitude) {
                console.log(`📍 [Pilot Agent] Sending location: ${agentResult.latitude}, ${agentResult.longitude}`);
                await sendLocation(chatId, parseFloat(agentResult.latitude), parseFloat(agentResult.longitude), '', '');
                mediaSent = true;
                // Send location info as separate text message
                if (agentResult.locationInfo && agentResult.locationInfo.trim()) {
                  await sendTextMessage(chatId, `📍 ${agentResult.locationInfo}`);
                }
              }
              
              // If no media was sent, send text response (if exists)
              if (!mediaSent && agentResult.text && agentResult.text.trim()) {
                // Clean technical markers from text responses too
                let cleanText = agentResult.text
                  .replace(/\[image\]/gi, '')
                  .replace(/\[video\]/gi, '')
                  .replace(/\[audio\]/gi, '')
                  .replace(/\[תמונה\]/gi, '')
                  .replace(/\[וידאו\]/gi, '')
                  .replace(/\[אודיו\]/gi, '')
                  .trim();
                if (cleanText) {
                  await sendTextMessage(chatId, cleanText);
                }
              }
              
              // 🧠 CRITICAL: Save bot's response to conversation history for continuity!
              // This allows the bot to see its own previous responses in future requests
              if (agentResult.text && agentResult.text.trim()) {
                await conversationManager.addMessage(chatId, 'assistant', agentResult.text);
                console.log(`💾 [Agent] Saved bot response to conversation history`);
              }
              
              console.log(`✅ [Agent] Completed successfully (${agentResult.iterations || 1} iterations, ${agentResult.toolsUsed?.length || 0} tools used)`);
            } else {
              await sendTextMessage(chatId, `❌ שגיאה: ${agentResult.error || 'לא הצלחתי לעבד את הבקשה'}`);
            }
            return; // Processing complete
            
          } catch (agentError) {
            console.error('❌ [Agent] Error:', agentError);
            await sendTextMessage(chatId, `❌ שגיאה בעיבוד הבקשה: ${agentError.message}`);
            return;
          }
  } catch (error) {
    console.error('❌ Error handling incoming message:', error.message || error);
  }
}
/**
 * Handle outgoing WhatsApp message (commands sent by you)
 */
async function handleOutgoingMessage(webhookData) {
  try {
    const messageData = webhookData.messageData;
    const senderData = webhookData.senderData;
    
    // Extract message ID for deduplication
    let messageId = webhookData.idMessage;
    
    // For edited messages, append suffix to ensure they're processed even if original was processed
    if (messageData.typeMessage === 'editedMessage') {
      messageId = `${messageId}_edited_${Date.now()}`;
      console.log(`✏️ Edited message (outgoing) - using unique ID for reprocessing: ${messageId}`);
    }
    
    // Check if we already processed this message
    if (processedMessages.has(messageId)) {
      console.log(`🔄 Duplicate outgoing message detected, skipping: ${messageId}`);
      return;
    }
    
    // Mark message as processed
    processedMessages.add(messageId);
    
    const chatId = senderData.chatId;
    const senderId = senderData.sender;
    const senderName = senderData.senderName || senderId;
    const senderContactName = senderData.senderContactName || "";
    const chatName = senderData.chatName || "";
    
    // Handle text messages (regular, extended, quoted, and edited)
    let messageText = null;
    
    if (messageData.typeMessage === 'textMessage') {
      messageText = messageData.textMessageData?.textMessage;
    } else if (messageData.typeMessage === 'extendedTextMessage') {
      messageText = messageData.extendedTextMessageData?.text;
    } else if (messageData.typeMessage === 'quotedMessage') {
      // When replying to a message, the text is in extendedTextMessageData
      messageText = messageData.extendedTextMessageData?.text;
      // BUT: If this is actually an image/video/sticker with caption (not a reply), extract the caption
      if (!messageText) {
        messageText = messageData.fileMessageData?.caption || 
                     messageData.imageMessageData?.caption || 
                     messageData.videoMessageData?.caption ||
                     messageData.stickerMessageData?.caption;
      }
    } else if (messageData.typeMessage === 'editedMessage') {
      // Handle edited messages - treat them as regular messages
      messageText = messageData.editedMessageData?.textMessage;
      console.log(`✏️ Edited message detected (outgoing): "${messageText}"`);
    }
    
    // Enhanced logging for outgoing messages
    console.log(`📤 Outgoing from ${senderName}:`);
    console.log(`   Message Type: ${messageData.typeMessage}${messageData.typeMessage === 'editedMessage' ? ' ✏️' : ''}`);
    console.log(`   messageText extracted: ${messageText ? `"${messageText.substring(0, 100)}"` : 'NULL/UNDEFINED'}`);
    if (messageText) {
      console.log(`   Text: ${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}`);
    }
    if (messageData.typeMessage === 'imageMessage') {
      const caption = messageData.fileMessageData?.caption || messageData.imageMessageData?.caption;
      console.log(`   Image Caption: ${caption || 'N/A'}`);
    }
    if (messageData.typeMessage === 'stickerMessage') {
      const caption = messageData.fileMessageData?.caption;
      console.log(`   Sticker Caption: ${caption || 'N/A'} (treating as image)`);
    }
    if (messageData.typeMessage === 'videoMessage') {
      const caption = messageData.fileMessageData?.caption || messageData.videoMessageData?.caption;
      console.log(`   Video Caption: ${caption || 'N/A'}`);
    }
    if (messageData.typeMessage === 'quotedMessage' && messageData.quotedMessage) {
      console.log(`   Quoted Message Type: ${messageData.quotedMessage.typeMessage}`);
      if (messageData.quotedMessage.textMessage) {
        console.log(`   Quoted Text: ${messageData.quotedMessage.textMessage.substring(0, 50)}...`);
      }
      if (messageData.quotedMessage.caption) {
        console.log(`   Quoted Caption: ${messageData.quotedMessage.caption.substring(0, 50)}...`);
      }
    }
    
    // Unified intent router for outgoing when text starts with "# "
    if (messageText && /^#\s+/.test(messageText.trim())) {
      try {
        const chatId = senderData.chatId;
        const senderId = senderData.sender;
        const senderName = senderData.senderName || senderId;
        const senderContactName = senderData.senderContactName || "";
        const chatName = senderData.chatName || "";

        // Extract the prompt (remove "# " prefix if exists)
        // For edited messages, # might be removed by WhatsApp/Green API
        const basePrompt = messageText.trim().replace(/^#\s+/, '').trim();
        
        // Check if this is a quoted/replied message
        // Only process quotedMessage if typeMessage is 'quotedMessage' (actual reply)
        // Don't process if it's just extendedTextMessage with leftover quotedMessage metadata
        const quotedMessage = messageData.quotedMessage;
        
        // IMPORTANT: Green API sends images/videos with captions as quotedMessage, but they're NOT actual quotes!
        // Check if this is a REAL quote (reply) or just a media message with caption
        // Logic:
        // - If caption exists AND matches/starts with the text → It's a NEW media message (not a quote)
        // - If caption doesn't exist OR doesn't match → It's a REAL quote
        const quotedCaption = quotedMessage?.caption;
        const extractedText = messageData.extendedTextMessageData?.text; // Don't shadow messageText!
        // Check if caption matches text (exact match OR caption starts with text, covering "# מה זה..." case)
        const captionMatchesText = quotedCaption && extractedText && 
                                  (quotedCaption === extractedText || 
                                   quotedCaption.startsWith(extractedText) ||
                                   extractedText.startsWith(quotedCaption));
        
        const isActualQuote = messageData.typeMessage === 'quotedMessage' && 
                             quotedMessage && 
                             quotedMessage.stanzaId &&
                             extractedText &&
                             !captionMatchesText; // It's a quote if text doesn't match caption
        
        let finalPrompt = basePrompt;
        let hasImage = messageData.typeMessage === 'imageMessage' || messageData.typeMessage === 'stickerMessage';
        let hasVideo = messageData.typeMessage === 'videoMessage';
        let hasAudio = messageData.typeMessage === 'audioMessage';
        let imageUrl = null;
        let videoUrl = null;
        let audioUrl = null;
        
        if (isActualQuote) {
          console.log(`🔗 Outgoing: Detected quoted message with stanzaId: ${quotedMessage.stanzaId}`);
          
          // Handle quoted message - merge content
          const quotedResult = await handleQuotedMessage(quotedMessage, basePrompt, chatId);
          
          // Check if there was an error processing the quoted message
          if (quotedResult.error) {
            await sendTextMessage(chatId, quotedResult.error);
            return;
          }
          
          finalPrompt = quotedResult.prompt;
          hasImage = quotedResult.hasImage;
          hasVideo = quotedResult.hasVideo;
          hasAudio = quotedResult.hasAudio;
          imageUrl = quotedResult.imageUrl;
          videoUrl = quotedResult.videoUrl;
          audioUrl = quotedResult.audioUrl;
        } else if (messageData.typeMessage === 'quotedMessage' && quotedMessage) {
          // This is a media message (image/video) with caption, NOT an actual quote
          // Extract downloadUrl from the message itself
          console.log(`📸 Outgoing: Media message with caption (not a quote) - Type: ${quotedMessage.typeMessage || 'unknown'}`);
          
          if (quotedMessage.typeMessage === 'imageMessage' || quotedMessage.typeMessage === 'stickerMessage') {
            hasImage = true;
            // Try all possible locations for downloadUrl
            imageUrl = messageData.downloadUrl || 
                      messageData.fileMessageData?.downloadUrl || 
                      messageData.imageMessageData?.downloadUrl ||
                      messageData.stickerMessageData?.downloadUrl ||
                      quotedMessage.downloadUrl ||
                      quotedMessage.fileMessageData?.downloadUrl ||
                      quotedMessage.imageMessageData?.downloadUrl ||
                      quotedMessage.stickerMessageData?.downloadUrl;
            
            // If still not found, try getMessage to fetch the current message's downloadUrl
            if (!imageUrl) {
              console.log('⚠️ Outgoing: downloadUrl not found in webhook, fetching from Green API...');
              try {
                const currentMessageId = webhookData.idMessage;
                const originalMessage = await greenApiService.getMessage(chatId, currentMessageId);
                imageUrl = originalMessage?.downloadUrl || 
                          originalMessage?.fileMessageData?.downloadUrl || 
                          originalMessage?.imageMessageData?.downloadUrl;
                console.log(`✅ Outgoing: downloadUrl fetched from getMessage: ${imageUrl ? 'found' : 'still NOT FOUND'}`);
              } catch (err) {
                console.log(`❌ Outgoing: Failed to fetch downloadUrl via getMessage: ${err.message}`);
              }
            }
            console.log(`📸 Outgoing: Image with caption detected, final downloadUrl: ${imageUrl ? 'found' : 'NOT FOUND'}`);
          } else if (quotedMessage.typeMessage === 'videoMessage') {
            hasVideo = true;
            videoUrl = messageData.downloadUrl || 
                      messageData.fileMessageData?.downloadUrl || 
                      messageData.videoMessageData?.downloadUrl ||
                      quotedMessage.downloadUrl ||
                      quotedMessage.fileMessageData?.downloadUrl ||
                      quotedMessage.videoMessageData?.downloadUrl;
            
            // If still not found, try getMessage to fetch the current message's downloadUrl
            if (!videoUrl) {
              console.log('⚠️ Outgoing: Video downloadUrl not found in webhook, fetching from Green API...');
              try {
                const currentMessageId = webhookData.idMessage;
                const originalMessage = await greenApiService.getMessage(chatId, currentMessageId);
                videoUrl = originalMessage?.downloadUrl || 
                          originalMessage?.fileMessageData?.downloadUrl || 
                          originalMessage?.videoMessageData?.downloadUrl;
                console.log(`✅ Outgoing: Video downloadUrl fetched from getMessage: ${videoUrl ? 'found' : 'still NOT FOUND'}`);
              } catch (err) {
                console.log(`❌ Outgoing: Failed to fetch video downloadUrl via getMessage: ${err.message}`);
              }
            }
            console.log(`🎥 Outgoing: Video with caption detected, final downloadUrl: ${videoUrl ? 'found' : 'NOT FOUND'}`);
          }
        }

        // Prepare quoted context for Agent (if quoted message exists) - Outgoing
        let quotedContext = null;
        if (isActualQuote && quotedMessage) {
          quotedContext = {
            type: quotedMessage.typeMessage || 'unknown',
            text: quotedMessage.textMessage || quotedMessage.caption || '',
            hasImage: quotedMessage.typeMessage === 'imageMessage' || quotedMessage.typeMessage === 'stickerMessage',
            hasVideo: quotedMessage.typeMessage === 'videoMessage',
            hasAudio: quotedMessage.typeMessage === 'audioMessage',
            audioUrl: audioUrl || null, // Include audio URL if available
            stanzaId: quotedMessage.stanzaId
          };
        }

        const normalized = {
          userText: `# ${finalPrompt}`, // Add back the # prefix for router
          hasImage: hasImage,
          hasVideo: hasVideo,
          hasAudio: hasAudio,
          quotedContext: quotedContext, // 🆕 Quoted message info for Agent
          chatType: chatId && chatId.endsWith('@g.us') ? 'group' : chatId && chatId.endsWith('@c.us') ? 'private' : 'unknown',
          language: 'he',
          authorizations: {
            // Outgoing bypasses authorization in existing logic, but router still expects booleans
            media_creation: true,
            group_creation: true,
            voice_allowed: true
          }
        };

        // ═══════════════════ AGENT MODE (Gemini Function Calling - OUTGOING) ═══════════════════
        // All outgoing requests are routed directly to the Agent for intelligent tool selection
        console.log('🤖 [AGENT - OUTGOING] Processing request with Gemini Function Calling');
        
        try {
            // 🧠 CRITICAL: Save user message to conversation history BEFORE processing
            // This ensures continuity and allows the bot to see the full conversation
            await conversationManager.addMessage(chatId, 'user', normalized.text || finalPrompt);
            console.log(`💾 [Agent - Outgoing] Saved user message to conversation history`);
            
            const agentResult = await routeToAgent(normalized, chatId);
            
            if (agentResult.success) {
              // Send any generated media (image/video/audio/poll) with captions
              let mediaSent = false;
              
              if (agentResult.imageUrl) {
                console.log(`📸 [Agent - Outgoing] Sending generated image: ${agentResult.imageUrl}`);
                // Images support captions - use them!
                // Clean the caption: remove URLs, markdown links, and technical markers
                let caption = agentResult.imageCaption || agentResult.text || '';
                caption = caption
                  .replace(/\[.*?\]\(https?:\/\/[^\)]+\)/g, '') // Remove markdown links
                  .replace(/https?:\/\/[^\s]+/gi, '') // Remove plain URLs
                  .replace(/\[image\]/gi, '') // Remove [image] markers
                  .replace(/\[video\]/gi, '') // Remove [video] markers
                  .replace(/\[audio\]/gi, '') // Remove [audio] markers
                  .replace(/\[תמונה\]/gi, '') // Remove [תמונה] markers
                  .replace(/\[וידאו\]/gi, '') // Remove [וידאו] markers
                  .replace(/\[אודיו\]/gi, '') // Remove [אודיו] markers
                  .replace(/התמונה.*?נוצרה בהצלחה!/gi, '') // Remove success messages
                  .replace(/הוידאו.*?נוצר בהצלחה!/gi, '')
                  .replace(/✅/g, '')
                  .trim();
                
                await sendFileByUrl(chatId, agentResult.imageUrl, `agent_image_${Date.now()}.png`, caption);
                mediaSent = true;
              }
              
              if (agentResult.videoUrl) {
                console.log(`🎬 [Agent - Outgoing] Sending generated video: ${agentResult.videoUrl}`);
                // Videos don't support captions well - send as file, text separately
                await sendFileByUrl(chatId, agentResult.videoUrl, `agent_video_${Date.now()}.mp4`, '');
                mediaSent = true;
                
                // If there's meaningful text (description/revised prompt), send it separately
                if (agentResult.text && agentResult.text.trim()) {
                  let videoDescription = agentResult.text
                    .replace(/https?:\/\/[^\s]+/gi, '') // Remove URLs
                    .replace(/\[image\]/gi, '') // Remove [image] markers
                    .replace(/\[video\]/gi, '') // Remove [video] markers
                    .replace(/\[audio\]/gi, '') // Remove [audio] markers
                    .replace(/\[תמונה\]/gi, '') // Remove [תמונה] markers
                    .replace(/\[וידאו\]/gi, '') // Remove [וידאו] markers
                    .replace(/\[אודיו\]/gi, '') // Remove [אודיו] markers
                    .trim();
                  if (videoDescription && videoDescription.length > 2) {
                    await sendTextMessage(chatId, videoDescription);
                  }
                }
              }
              
              if (agentResult.audioUrl) {
                console.log(`🎵 [Agent - Outgoing] Sending generated audio: ${agentResult.audioUrl}`);
                // Audio doesn't support captions - send as file only
                const fullAudioUrl = agentResult.audioUrl.startsWith('http') 
                  ? agentResult.audioUrl 
                  : getStaticFileUrl(agentResult.audioUrl.replace('/static/', ''));
                await sendFileByUrl(chatId, fullAudioUrl, `agent_audio_${Date.now()}.mp3`, '');
                mediaSent = true;
                
                // For audio files (TTS/translate_and_speak), don't send text - the audio IS the response
                // No need for textual descriptions like "הנה הקלטה קולית..."
              }
              
              if (agentResult.poll) {
                console.log(`📊 [Agent - Outgoing] Sending poll: ${agentResult.poll.question}`);
                // Convert options to Green API format
                const pollOptions = agentResult.poll.options.map(opt => ({ optionName: opt }));
                await sendPoll(chatId, agentResult.poll.question, pollOptions, false);
                mediaSent = true;
              }
              
              if (agentResult.latitude && agentResult.longitude) {
                console.log(`📍 [Agent - Outgoing] Sending location: ${agentResult.latitude}, ${agentResult.longitude}`);
                await sendLocation(chatId, parseFloat(agentResult.latitude), parseFloat(agentResult.longitude), '', '');
                mediaSent = true;
                // Send location info as separate text message
                if (agentResult.locationInfo && agentResult.locationInfo.trim()) {
                  await sendTextMessage(chatId, `📍 ${agentResult.locationInfo}`);
                }
              }
              
              // If no media was sent, send text response (if exists)
              if (!mediaSent && agentResult.text && agentResult.text.trim()) {
                // Clean technical markers from text responses too
                let cleanText = agentResult.text
                  .replace(/\[image\]/gi, '')
                  .replace(/\[video\]/gi, '')
                  .replace(/\[audio\]/gi, '')
                  .replace(/\[תמונה\]/gi, '')
                  .replace(/\[וידאו\]/gi, '')
                  .replace(/\[אודיו\]/gi, '')
                  .trim();
                if (cleanText) {
                  await sendTextMessage(chatId, cleanText);
                }
              }
              
              // 🧠 CRITICAL: Save bot's response to conversation history for continuity!
              // This allows the bot to see its own previous responses in future requests
              if (agentResult.text && agentResult.text.trim()) {
                await conversationManager.addMessage(chatId, 'assistant', agentResult.text);
                console.log(`💾 [Agent - Outgoing] Saved bot response to conversation history`);
              }
              
              console.log(`✅ [Agent - Outgoing] Completed successfully (${agentResult.iterations || 1} iterations, ${agentResult.toolsUsed?.length || 0} tools used)`);
            } else {
              await sendTextMessage(chatId, `❌ שגיאה: ${agentResult.error || 'לא הצלחתי לעבד את הבקשה'}`);
            }
            return; // Exit early - no need for regular flow
            
          } catch (agentError) {
            console.error('❌ [Agent - Outgoing] Error:', agentError);
            await sendTextMessage(chatId, `❌ שגיאה בעיבוד הבקשה: ${agentError.message}`);
            return;
          }
}

module.exports = router;