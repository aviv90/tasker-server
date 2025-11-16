/**
 * Gemini Special Operations
 * 
 * Specialized operations: music parsing, TTS, polls, location services.
 * Extracted from gemini/core.js (Phase 4.5)
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function parseMusicRequest(prompt) {
    try {
        // First, try simple regex detection for common patterns (fast and reliable)
        // Hebrew patterns: כולל וידאו, עם וידאו, גם וידאו, כולל קליפ, עם קליפ, וידאו, קליפ
        // English patterns: with video, and video, plus video, with clip, and clip, video, clip
        const videoPatterns = /\b(with|and|plus|including|include)\s+(video|clip)\b|כולל\s+(וידאו|קליפ)|עם\s+(וידאו|קליפ)|גם\s+(וידאו|קליפ)|ועם\s+(וידאו|קליפ)|\bvideo\s*clip\b|\bmusic\s*video\b/i;
        
        const regexMatch = videoPatterns.test(prompt);
        
        if (regexMatch) {
            console.log('🎬 Video requested with music');
            // Clean the prompt by removing video/clip mentions
            const cleanPrompt = prompt
                .replace(/\s*(with|and|plus|including|include)\s+(video|clip)\s*/gi, ' ')
                .replace(/\s*כולל\s+(וידאו|קליפ)\s*/g, ' ')
                .replace(/\s*עם\s+(וידאו|קליפ)\s*/g, ' ')
                .replace(/\s*גם\s+(וידאו|קליפ)\s*/g, ' ')
                .replace(/\s*ועם\s+(וידאו|קליפ)\s*/g, ' ')
                .replace(/\s*video\s*clip\s*/gi, ' ')
                .replace(/\s*music\s*video\s*/gi, ' ')
                .trim()
                .replace(/\s+/g, ' '); // normalize spaces
            
            return {
                wantsVideo: true,
                cleanPrompt: cleanPrompt || prompt
            };
        }
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash" 
        });
        
        const analysisPrompt = `Analyze this music generation request and determine if the user wants a video along with the song.

User request: "${prompt}"

Return ONLY a JSON object (no markdown, no extra text) with this exact structure:
{
  "wantsVideo": true/false,
  "cleanPrompt": "the music description without video request"
}

Rules:
1. If user explicitly requests video or clip (e.g., "with video", "כולל וידאו", "עם וידאו", "גם וידאו", "plus video", "and video", "ועם וידאו", "קליפ", "כולל קליפ", "עם קליפ", "clip", "with clip", "video clip", "music video"), set wantsVideo=true
2. Extract the actual music description (without the video/clip instruction)
3. Keep the cleanPrompt focused on music style, theme, mood, lyrics topic
4. If no video/clip is mentioned, set wantsVideo=false and keep original prompt
5. IMPORTANT: The presence of other words (like "Suno", "בעזרת", "באמצעות") should NOT affect video detection - focus ONLY on video/clip keywords

Examples:
Input: "צור שיר בסגנון רוק על אהבה כולל וידאו"
Output: {"wantsVideo":true,"cleanPrompt":"צור שיר בסגנון רוק על אהבה"}

Input: "צור שיר על הכלב דובי בעזרת Suno, כולל וידאו"
Output: {"wantsVideo":true,"cleanPrompt":"צור שיר על הכלב דובי בעזרת Suno"}

Input: "create a pop song about summer with video"
Output: {"wantsVideo":true,"cleanPrompt":"create a pop song about summer"}

Input: "שיר עצוב על פרידה עם קליפ"
Output: {"wantsVideo":true,"cleanPrompt":"שיר עצוב על פרידה"}

Input: "שיר רומנטי כולל קליפ"
Output: {"wantsVideo":true,"cleanPrompt":"שיר רומנטי"}

Input: "make a rock song with clip"
Output: {"wantsVideo":true,"cleanPrompt":"make a rock song"}

Input: "make a song with Suno and video"
Output: {"wantsVideo":true,"cleanPrompt":"make a song with Suno"}

Input: "צור שיר ג'אז"
Output: {"wantsVideo":false,"cleanPrompt":"צור שיר ג'אז"}

Input: "make a happy song"
Output: {"wantsVideo":false,"cleanPrompt":"make a happy song"}`;

        const result = await model.generateContent(analysisPrompt);
        const response = result.response;
        
        if (!response.candidates || response.candidates.length === 0) {
            console.log('❌ Gemini music parsing: No candidates returned');
            return { wantsVideo: false, cleanPrompt: prompt };
        }
        
        let rawText = response.text().trim();
        
        // Remove markdown code fences if present
        rawText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        
        const parsed = JSON.parse(rawText);
        
        if (parsed.wantsVideo) {
            console.log('🎬 Video requested with music (LLM detected)');
        }
        return parsed;
        
    } catch (err) {
        console.error('❌ Error parsing music request:', err);
        // Fallback: no video
        return { wantsVideo: false, cleanPrompt: prompt };
    }
}

/**
 * Parse text-to-speech request to detect if translation is needed
 * @param {string} prompt - User's TTS request
 * @returns {Object} - { needsTranslation: boolean, text: string, targetLanguage?: string, languageCode?: string }
 */
async function parseTextToSpeechRequest(prompt) {
    try {
        console.log('🔍 Parsing TTS request for translation needs');
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash" 
        });
        
        const analysisPrompt = `Analyze this text-to-speech request and determine if the user wants the output in a specific language.

User request: "${prompt}"

Return ONLY a JSON object (no markdown, no extra text) with this exact structure:
{
  "needsTranslation": true/false,
  "text": "the text to speak",
  "targetLanguage": "language name in English (e.g., Japanese, French, Spanish)",
  "languageCode": "ISO 639-1 code (e.g., ja, fr, es, he, en, ar)"
}

Rules:
1. If user explicitly requests a language (e.g., "say X in Japanese", "אמור X ביפנית", "read X in French"), set needsTranslation=true
2. Extract the actual text to speak (without the language instruction)
3. Map the target language to its ISO code
4. If no specific language is requested, set needsTranslation=false, use the original text, and omit targetLanguage/languageCode

Examples:
Input: "אמור היי מה נשמע ביפנית"
Output: {"needsTranslation":true,"text":"היי מה נשמע","targetLanguage":"Japanese","languageCode":"ja"}

Input: "say hello world in French"
Output: {"needsTranslation":true,"text":"hello world","targetLanguage":"French","languageCode":"fr"}

Input: "קרא את הטקסט הזה בערבית: שלום עולם"
Output: {"needsTranslation":true,"text":"שלום עולם","targetLanguage":"Arabic","languageCode":"ar"}

Input: "אמור שלום"
Output: {"needsTranslation":false,"text":"אמור שלום"}

Input: "read this text"
Output: {"needsTranslation":false,"text":"read this text"}`;

        const result = await model.generateContent(analysisPrompt);
        const response = result.response;
        
        if (!response.candidates || response.candidates.length === 0) {
            console.log('❌ Gemini TTS parsing: No candidates returned');
            return { needsTranslation: false, text: prompt };
        }
        
        let rawText = response.text().trim();
        
        // Remove markdown code fences if present
        rawText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        
        const parsed = JSON.parse(rawText);
        
        console.log('✅ TTS request parsed:', parsed);
        return parsed;
        
    } catch (err) {
        console.error('❌ Error parsing TTS request:', err);
        // Fallback: no translation
        return { needsTranslation: false, text: prompt };
    }
}

/**
 * Generate creative poll with optional rhyming
 * @param {string} topic - Poll topic
 * @param {boolean} withRhyme - Whether to use rhyming options
 * @returns {Object} - Poll data
 */
async function generateCreativePoll(topic, withRhyme = true) {
    try {
        console.log(`📊 Generating creative poll about: ${topic} ${withRhyme ? '(with rhyme)' : '(without rhyme)'}`);
        
        const cleanTopic = sanitizeText(topic);
        
        // Randomly choose number of options (2-4)
        const crypto = require('crypto');
        const numOptions = crypto.randomInt(2, 5); // 2, 3, or 4
        console.log(`🎲 Randomly selected ${numOptions} poll options`);
        
        // Create prompt based on rhyming preference
        let pollPrompt;
        
        if (withRhyme) {
            pollPrompt = `אתה יוצר סקרים יצירתיים ומשעשעים בעברית עם חריזה מושלמת.

נושא הסקר: ${cleanTopic}

צור סקר עם:
1. שאלה מעניינת ויצירתית (יכולה להיות "מה היית מעדיפ/ה?" או כל שאלה אחרת)
2. בדיוק ${numOptions} תשובות אפשריות
3. ⭐ חשוב ביותר: כל התשובות חייבות לחרוז זו עם זו בחריזה מושלמת! ⭐
4. החריזה חייבת להיות בסוף כל תשובה (המילה האחרונה)
5. התשובות צריכות להיות קצרות (עד 100 תווים כל אחת)
6. התשובות צריכות להיות קשורות לנושא
7. התשובות חייבות להיות משעשעות ויצירתיות

דוגמאות לחרוזים מושלמים:
- נושא: חתולים (2 תשובות)
  שאלה: "מה היית מעדיפ/ה?"
  תשובה 1: "חתול כועס"
  תשובה 2: "נמר לועס"
  (חרוז: כועס / לועס)

- נושא: כלבים (3 תשובות)
  שאלה: "איזה כלב הכי טוב?"
  תשובה 1: "גולדן רטריבר נהדר"
  תשובה 2: "ביגל קטן ויפה בחדר"
  תשובה 3: "פודל לבן שמתגבר"
  (חרוז: נהדר / בחדר / מתגבר)

- נושא: פיצה (4 תשובות)
  שאלה: "איזו פיצה הכי טעימה?"
  תשובה 1: "פיצה עם זיתים"
  תשובה 2: "פלאפל עם חומוס שלמים"
  תשובה 3: "בורקס במילוי עשיר ושמנים"
  תשובה 4: "שווארמה עם בצל וחצילים"
  (חרוז: זיתים / שלמים / שמנים / חצילים)

- נושא: קפה (2 תשובות)
  שאלה: "איך אתה שותה קפה?"
  תשובה 1: "עם חלב וסוכר"
  תשובה 2: "שחור וחזק כמו נמר"
  (חרוז: סוכר / נמר)

חוקים קפדניים:
⭐ החרוז חייב להיות מושלם - המילה האחרונה בכל תשובה חייבת לחרוז!
- התשובות חייבות להיות שונות זו מזו במשמעות
- השאלה מקסימום 255 תווים
- כל תשובה מקסימום 100 תווים
- כל התשובות (${numOptions}) חייבות לחרוז ביחד!

החזר JSON בלבד בפורמט:
{
  "question": "השאלה כאן",
  "options": ["תשובה 1", "תשובה 2"${numOptions > 2 ? ', "תשובה 3"' : ''}${numOptions > 3 ? ', "תשובה 4"' : ''}]
}`;
        } else {
            pollPrompt = `אתה יוצר סקרים יצירתיים ומשעשעים בעברית.

נושא הסקר: ${cleanTopic}

צור סקר עם:
1. שאלה מעניינת ויצירתית (יכולה להיות "מה היית מעדיפ/ה?" או כל שאלה אחרת)
2. בדיוק ${numOptions} תשובות אפשריות
3. התשובות צריכות להיות קצרות (עד 100 תווים כל אחת)
4. התשובות צריכות להיות קשורות לנושא
5. התשובות חייבות להיות משעשעות, יצירתיות, ומעניינות
6. ⭐ חשוב: התשובות לא צריכות לחרוז! ⭐

דוגמאות ללא חריזה:
- נושא: חתולים (2 תשובות)
  שאלה: "איזה חתול היית מעדיפ/ה?"
  תשובה 1: "חתול פרסי רך ונחמד"
  תשובה 2: "חתול רחוב עצמאי ופראי"

- נושא: פיצה (3 תשובות)
  שאלה: "איזו פיצה הכי טעימה?"
  תשובה 1: "מרגריטה קלאסית"
  תשובה 2: "פפרוני עם גבינה"
  תשובה 3: "ירקות טריים ובריאים"

- נושא: קפה (4 תשובות)
  שאלה: "איך אתה שותה קפה?"
  תשובה 1: "אספרסו חזק"
  תשובה 2: "קפוצ'ינו מוקצף"
  תשובה 3: "לאטה עם חלב שקדים"
  תשובה 4: "קר עם קרח"

חוקים קפדניים:
- התשובות חייבות להיות שונות זו מזו במשמעות
- השאלה מקסימום 255 תווים
- כל תשובה מקסימום 100 תווים
- התשובות לא צריכות לחרוז (זה חשוב!)

החזר JSON בלבד בפורמט:
{
  "question": "השאלה כאן",
  "options": ["תשובה 1", "תשובה 2"${numOptions > 2 ? ', "תשובה 3"' : ''}${numOptions > 3 ? ', "תשובה 4"' : ''}]
}`;
        }

        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash" 
        });
        
        const result = await model.generateContent(pollPrompt);
        
        if (!result.response) {
            throw new Error('No response from Gemini');
        }
        
        const responseText = result.response.text();
        
        // Try to extract JSON from response
        let jsonText = responseText.trim();
        
        // If wrapped in code fences, strip them
        const fenceMatch = jsonText.match(/```[a-zA-Z]*\n([\s\S]*?)\n```/);
        if (fenceMatch && fenceMatch[1]) {
            jsonText = fenceMatch[1].trim();
        }
        
        let parsed;
        try {
            parsed = JSON.parse(jsonText);
        } catch (parseError) {
            console.error('❌ Failed to parse Gemini poll response:', jsonText);
            throw new Error('Failed to parse poll data from Gemini');
        }
        
        // Validate the response
        if (!parsed.question || !parsed.options || !Array.isArray(parsed.options)) {
            throw new Error('Invalid poll data structure from Gemini');
        }
        
        // Validate number of options (must be between 2-4 and match what we requested)
        if (parsed.options.length < 2 || parsed.options.length > 4) {
            throw new Error(`Invalid number of options: ${parsed.options.length} (expected ${numOptions})`);
        }
        
        // Ensure limits
        if (parsed.question.length > 255) {
            parsed.question = parsed.question.substring(0, 252) + '...';
        }
        
        // Truncate each option if needed
        parsed.options = parsed.options.map(opt => {
            if (opt.length > 100) {
                return opt.substring(0, 97) + '...';
            }
            return opt;
        });
        
        console.log(`✅ Poll generated successfully with ${parsed.options.length} ${withRhyme ? 'rhyming' : 'non-rhyming'} options:`);
        console.log(`   Question: "${parsed.question}"`);
        parsed.options.forEach((opt, idx) => {
            console.log(`   Option ${idx + 1}: "${opt}"`);
        });
        
        return {
            success: true,
            question: parsed.question,
            options: parsed.options,
            numOptions: parsed.options.length
        };
        
    } catch (err) {
        console.error('❌ Poll generation error:', err);
        return {
            success: false,
            error: err.message || 'Failed to generate poll'
        };
    }
}

/**
 * Get location information using Google Maps grounding
 * @param {number} latitude - Latitude
 * @param {number} longitude - Longitude
 * @returns {Object} - Location information
 */
async function getLocationInfo(latitude, longitude) {
    try {
        console.log(`🗺️ Getting location info for: ${latitude}, ${longitude}`);
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash" 
        });
        
        // HYBRID APPROACH:
        // 1. Try Google Maps Grounding first (best for populated areas)
        // 2. If it fails or returns unhelpful response, fallback to general Gemini knowledge
        
        let text = '';
        let usedMapsGrounding = false;
        
        try {
            console.log('🗺️ Trying Google Maps Grounding first...');
            const mapsPrompt = `תאר את המיקום בקואורדינטות: קו רוחב ${latitude}°, קו אורך ${longitude}°.
            
באיזו עיר או אזור זה נמצא? באיזו מדינה? מה מעניין או מפורסם במקום הזה?

תשובה קצרה ומעניינת בעברית (2-3 שורות).`;

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
                // If it asks for more info or says it needs a specific location, it means no data
                const unhelpfulPatterns = [
                    'אני זקוק למיקום',
                    'אני צריך מיקום',
                    'איזה מיקום',
                    'איזה מקום',
                    'ספק את שם',
                    'ספק שם',
                    'ספקי את',
                    'ספק לי פרטים',
                    'ספקו פרטים',
                    'כדי שאוכל לתאר',
                    'כדי לתאר',
                    'אנא ספק',
                    'לא צוין מיקום',
                    'לא צוינה',
                    'לא ניתן מיקום',
                    'I need a location',
                    'I need more information',
                    'which location',
                    'which place',
                    'provide the location',
                    'provide the place',
                    'provide a location',
                    'provide more details',
                    'provide details',
                    'not specified',
                    'no location specified',
                    'location not specified',
                    'אנא ציין',
                    'please specify',
                    'לא ברור',
                    'unclear',
                    'לא יכול לתאר',
                    'cannot describe'
                ];
                
                const isUnhelpful = unhelpfulPatterns.some(pattern => 
                    text.toLowerCase().includes(pattern.toLowerCase())
                );
                
                if (!isUnhelpful && text.trim().length > 20) {
                    console.log('✅ Google Maps Grounding provided useful info');
                    usedMapsGrounding = true;
                } else {
                    console.log('⚠️ Google Maps Grounding response not useful, falling back to general knowledge...');
                    text = ''; // Reset for fallback
                }
            }
        } catch (mapsError) {
            console.log(`⚠️ Google Maps Grounding failed: ${mapsError.message}, falling back to general knowledge...`);
            text = ''; // Reset for fallback
        }
        
        // Fallback: Use Gemini's general geographic knowledge
        if (!text || text.trim().length === 0) {
            console.log('🌍 Using Gemini general geographic knowledge...');
            const generalPrompt = `תאר את המיקום הגיאוגרפי: קו רוחב ${latitude}°, קו אורך ${longitude}°.

ספר בקצרה (2-3 שורות):
- באיזו מדינה, אזור או אוקיינוס זה נמצא
- מה האקלים והטבע של האזור
- אם יש שם משהו מעניין או מפורסם, ציין את זה

תשובה מעניינת בעברית.`;

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
        
        // CRITICAL: Clean JSON/snippets from response if Gemini accidentally returned structured data
        // Sometimes Gemini returns JSON with "snippets" and "link" instead of plain text
        text = text.trim();
        
        // Remove JSON blocks (```json ... ``` or naked JSON objects)
        if (text.includes('"snippets"') || text.includes('"link"') || (text.startsWith('{') && text.endsWith('}'))) {
            console.warn('⚠️ Detected JSON in location description, cleaning...');
            
            // Try to extract just the text content from JSON
            try {
                // Remove markdown code blocks
                let cleanText = text.replace(/```json?\s*|\s*```/g, '');
                
                // Try to parse as JSON
                const jsonData = JSON.parse(cleanText);
                
                // Extract meaningful text fields (not snippets or links)
                if (jsonData.description) {
                    text = jsonData.description;
                } else if (jsonData.text) {
                    text = jsonData.text;
                } else if (jsonData.answer) {
                    text = jsonData.answer;
                } else {
                    // Fallback: extract any long string values (likely the description)
                    for (const key in jsonData) {
                        if (typeof jsonData[key] === 'string' && jsonData[key].length > 30 && 
                            key !== 'link' && key !== 'snippets') {
                            text = jsonData[key];
                            break;
                        }
                    }
                }
                
                console.log(`✅ Cleaned JSON, extracted text: ${text.substring(0, 80)}...`);
            } catch (err) {
                // If JSON parsing fails, remove JSON-like patterns
                console.warn(`⚠️ Could not parse JSON, removing patterns: ${err.message}`);
                text = text
                    .replace(/\{[^}]*"snippets"[^}]*\}/g, '')
                    .replace(/\{[^}]*"link"[^}]*\}/g, '')
                    .replace(/```json?\s*[\s\S]*?\s*```/g, '')
                    .trim();
            }
        }
        
        // Final validation: ensure we still have meaningful text
        if (!text || text.length < 10) {
            text = `מיקום: קו רוחב ${latitude}°, קו אורך ${longitude}°`;
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
 * Get bounds for a city/location name using Google Maps Geocoding
 * Optimized to get accurate bounds and handle various city sizes
 * @param {string} locationName - City or location name (e.g., "תל אביב", "ירושלים", "Barcelona")
 * @returns {Promise<Object|null>} - {minLat, maxLat, minLng, maxLng, foundName, country} or null if not found
 */
async function getLocationBounds(locationName) {
    try {
        console.log(`🔍 Getting bounds for location: "${locationName}"`);
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash" 
        });
        
        // Improved prompt: request location name, country AND coordinates for validation
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
            // Note: Using Gemini's general knowledge + Google Search grounding (automatic)
            // Google Maps tool requires specific toolConfig which isn't suitable for geocoding by name
        });
        
        const response = result.response;
        if (!response.candidates || response.candidates.length === 0) {
            console.log(`❌ No response for location: ${locationName}`);
            return null;
        }
        
        const text = response.text();
        console.log(`📍 Geocoding response for "${locationName}": ${text.substring(0, 200)}`);
        
        // Try to parse JSON from response with improved extraction
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
        // This prevents cases like requesting "Tel Aviv" and getting "Tokyo"
        const requestedLower = locationName.toLowerCase().trim();
        const foundLower = foundName.toLowerCase().trim();
        const cityLower = (city || '').toLowerCase().trim();
        
        // Check if there's a reasonable match (contains, starts with, or similar)
        const isReasonableMatch = 
            foundLower.includes(requestedLower) || 
            requestedLower.includes(foundLower) ||
            cityLower.includes(requestedLower) ||
            requestedLower.includes(cityLower) ||
            // Allow some flexibility for translations/variations
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
                console.log(`✅ Found viewport bounds for "${locationName}" (${foundName}): ${JSON.stringify({minLat: bounds.minLat, maxLat: bounds.maxLat, minLng: bounds.minLng, maxLng: bounds.maxLng})}`);
                return bounds;
            }
        }
        
        // Fallback: Calculate bounds from center point with dynamic radius based on city size
        // Use smaller radius for better precision (covers most cities well)
        // Adjust radius slightly based on latitude (longitude degrees are shorter near poles)
        const baseRadius = 0.4; // ~44km at equator, smaller for better precision
        const latAdjustment = Math.cos(centerLat * Math.PI / 180); // Adjust for longitude spacing
        
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
        
        console.log(`✅ Found center-point bounds for "${locationName}" (${foundName}): ${JSON.stringify({minLat: bounds.minLat, maxLat: bounds.maxLat, minLng: bounds.minLng, maxLng: bounds.maxLng})}`);
        return bounds;
        
    } catch (err) {
        console.error(`❌ Error getting bounds for "${locationName}":`, err.message);
        console.error(`   Stack: ${err.stack}`);
        return null;
    }
}

module.exports = {
  parseMusicRequest,
  parseTextToSpeechRequest,
  generateCreativePoll,
  getLocationInfo,
  getLocationBounds
};
