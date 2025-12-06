
import axios from 'axios';
import logger from '../../utils/logger';

import config from '../../config/env';

const SERPAPI_KEY = config.ai.serpApi.apiKey;
const POPULAR_DESTINATIONS = [
    'LHR', // London
    'JFK', // New York
    'CDG', // Paris
    'FCO', // Rome
    'BER', // Berlin
    'AMS', // Amsterdam
    'BKK', // Bangkok
    'HND', // Tokyo
    'DXB', // Dubai
    'IST', // Istanbul
    'MAD', // Madrid
    'BCN', // Barcelona
    'ATH', // Athens
    'LCA', // Larnaca
    'BUD', // Budapest
    'PRG', // Prague
];

// Mapping for common inputs to IATA codes
const CITY_TO_IATA_MAPPING: Record<string, string> = {
    // Israel
    'tlv': 'TLV',
    'tel aviv': 'TLV',
    'tel-aviv': 'TLV',
    'ben gurion': 'TLV',
    'תל אביב': 'TLV',
    'ת״א': 'TLV',
    'נתבג': 'TLV',
    'נתב״ג': 'TLV',
    'בן גוריון': 'TLV',
    'mtlv': 'TLV', // Common typo?

    // US
    'nyc': 'JFK',
    'new york': 'JFK',
    'jfk': 'JFK',
    'ניו יורק': 'JFK',
    'sfo': 'SFO',
    'san francisco': 'SFO',
    'san fran': 'SFO',
    'סן פרנסיסקו': 'SFO',
    'lax': 'LAX',
    'los angeles': 'LAX',
    'לוס אנגלס': 'LAX',
    'לוס אנג׳לס': 'LAX',

    // Europe
    'lon': 'LHR',
    'london': 'LHR',
    'לונדון': 'LHR',
    'par': 'CDG',
    'paris': 'CDG',
    'פריז': 'CDG',
    'ber': 'BER',
    'berlin': 'BER',
    'ברלין': 'BER',
    'rom': 'FCO',
    'rome': 'FCO',
    'roma': 'FCO',
    'רומא': 'FCO',
    'ams': 'AMS',
    'amsterdam': 'AMS',
    'אמסטרדם': 'AMS',
    'mad': 'MAD',
    'madrid': 'MAD',
    'מדריד': 'MAD',
    'bcn': 'BCN',
    'barcelona': 'BCN',
    'ברצלונה': 'BCN',
    'ath': 'ATH',
    'athens': 'ATH',
    'אתונה': 'ATH',
    'bud': 'BUD',
    'budapest': 'BUD',
    'בודפשט': 'BUD',
    'prg': 'PRG',
    'prague': 'PRG',
    'פראג': 'PRG',
    'lca': 'LCA',
    'larnaca': 'LCA',
    'לרנקה': 'LCA',
    'kiev': 'IEV',
    'קייב': 'IEV',
    'moscow': 'SVO',
    'מוסקבה': 'SVO',

    // Asia
    'bkk': 'BKK',
    'bangkok': 'BKK',
    'בנגקוק': 'BKK',
    'tyo': 'HND',
    'tokyo': 'HND',
    'טוקיו': 'HND',
    'dxb': 'DXB',
    'dubai': 'DXB',
    'דובאי': 'DXB',
    'kazakhstan': 'ALA', // Almaty as default
    'קזחסטן': 'ALA',
    'almaty': 'ALA',
    'אלמטי': 'ALA',
    'cyprus': 'LCA',
    'קפריסין': 'LCA'
};

const HEBREW_MONTHS: Record<string, string> = {
    'ינואר': '01', 'פברואר': '02', 'מרץ': '03', 'אפריל': '04',
    'מאי': '05', 'יוני': '06', 'יולי': '07', 'אוגוסט': '08',
    'ספטמבר': '09', 'אוקטובר': '10', 'נובמבר': '11', 'דצמבר': '12',
    'בינואר': '01', 'בפברואר': '02', 'במרץ': '03', 'באפריל': '04',
    'במאי': '05', 'ביוני': '06', 'ביולי': '07', 'באוגוסט': '08',
    'בספטמבר': '09', 'באוקטובר': '10', 'בנובמבר': '11', 'בדצמבר': '12',
};

const HEBREW_NUMBERS: Record<string, string> = {
    'אחד': '1', 'אחת': '1', 'שניים': '2', 'שתיים': '2', 'שלושה': '3', 'שלוש': '3',
    'ארבעה': '4', 'ארבע': '4', 'חמישה': '5', 'חמש': '5', 'שישה': '6', 'שש': '6',
    'שבעה': '7', 'שבע': '7', 'שמונה': '8', 'תשעה': '9', 'תשע': '9',
    'עשרה': '10', 'עשר': '10', 'אחד עשר': '11', 'אחת עשרה': '11', 'שנים עשר': '12', 'שתים עשרה': '12',
    'שלושה עשר': '13', 'שלוש עשרה': '13', 'ארבעה עשר': '14', 'ארבע עשרה': '14', 'חמישה עשר': '15', 'חמש עשרה': '15',
    'שישה עשר': '16', 'שש עשרה': '16', 'שבעה עשר': '17', 'שבע עשרה': '17', 'שמונה עשר': '18', 'שמונה עשרה': '18',
    'תשעה עשר': '19', 'תשע עשרה': '19', 'עשרים': '20', 'עשרים ואחד': '21', 'עשרים ואחת': '21',
    'עשרים ושניים': '22', 'עשרים ושתיים': '22', 'עשרים ושלושה': '23', 'עשרים ושלוש': '23',
    'עשרים וארבעה': '24', 'עשרים וארבע': '24', 'עשרים וחמישה': '25', 'עשרים וחמש': '25',
    'עשרים ושישה': '26', 'עשרים ושש': '26', 'עשרים ושבעה': '27', 'עשרים ושבע': '27',
    'עשרים ושמונה': '28', 'עשרים ותשעה': '29', 'עשרים ותשע': '29',
    'שלושים': '30', 'שלושים ואחד': '31', 'שלושים ואחת': '31'
};

/**
 * Normalizes date input to YYYY-MM-DD
 */
function normalizeDate(input: string): string {
    let clean = input.trim();
    if (!clean) return '';

    // 1. Strict YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;

    // 2. Handle verbal Hebrew dates: "4 בדצמבר", "שניים בינואר", "4.12"

    // Replace verbal numbers with digits? "שניים" -> "2"
    for (const [word, digit] of Object.entries(HEBREW_NUMBERS)) {
        const regex = new RegExp(`^${word}(\\s|$)`, 'i'); // Match start of string
        if (regex.test(clean)) {
            clean = clean.replace(regex, `${digit}$1`);
        }
    }

    // Attempt to find Hebrew month
    let foundMonthIndex = -1;

    for (const [monthName, monthDigit] of Object.entries(HEBREW_MONTHS)) {
        if (clean.includes(monthName)) {
            foundMonthIndex = parseInt(monthDigit);
            break;
        }
    }

    if (foundMonthIndex !== -1) {
        // We found a hebrew month. Look for the day.
        const dayMatch = clean.match(/(\d{1,2})/);
        if (dayMatch && dayMatch[1]) {
            const d = parseInt(dayMatch[1]);
            const today = new Date();
            let y = today.getFullYear();

            // Check for explicit year in input
            const yearMatch = clean.match(/(\d{4})/);
            if (yearMatch && yearMatch[1]) {
                y = parseInt(yearMatch[1]);
            } else {
                const dateThisYear = new Date(y, foundMonthIndex - 1, d);
                if (dateThisYear.getTime() < today.getTime() - 90 * 24 * 60 * 60 * 1000) {
                    y++;
                }
            }
            return `${y}-${String(foundMonthIndex).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }
    }

    // 3. Numeric Formats: DD.MM.YYYY, DD/MM/YY, DD-MM
    const dmyMatch = clean.match(/^(\d{1,2})[./-](\d{1,2})([./-](\d{2,4}))?$/);
    if (dmyMatch && dmyMatch[1] && dmyMatch[2]) {
        const d = dmyMatch[1].padStart(2, '0');
        const m = dmyMatch[2].padStart(2, '0');
        let yStr = dmyMatch[4];

        let y: number;
        const today = new Date();

        if (yStr) {
            if (yStr.length === 2) {
                y = 2000 + parseInt(yStr); // Assume 20xx
            } else {
                y = parseInt(yStr);
            }
        } else {
            y = today.getFullYear();
            const dateThisYear = new Date(y, parseInt(m) - 1, parseInt(d));
            if (dateThisYear.getTime() < today.getTime() - 90 * 24 * 60 * 60 * 1000) {
                y++;
            }
        }
        return `${y}-${m}-${d}`;
    }

    return clean;
}

// Mapping for IATA to display city name
const IATA_TO_CITY_NAME: Record<string, string> = {
    'LHR': 'לונדון',
    'JFK': 'ניו יורק',
    'CDG': 'פריז',
    'FCO': 'רומא',
    'BER': 'ברלין',
    'AMS': 'אמסטרדם',
    'BKK': 'בנגקוק',
    'HND': 'טוקיו',
    'DXB': 'דובאי',
    'IST': 'איסטנבול',
    'MAD': 'מדריד',
    'BCN': 'ברצלונה',
    'ATH': 'אתונה',
    'LCA': 'לרנקה',
    'BUD': 'בודפשט',
    'PRG': 'פראג',
    'TLV': 'תל אביב',
    'ALA': 'אלמטי (קזחסטן)'
};

export interface FlightLeg {
    origin: string;
    destination: string;
    airline: string;
    flightNumber: string;
    departureTime: string;
    arrivalTime: string;
    duration: string;
    originCode: string;
    destinationCode: string;
}

export interface FlightOffer {
    destination: string; // Final destination formatted
    airline: string; // Primary airline (or "Multiple")
    price: string;
    departureTime: string; // Initial departure
    arrivalTime: string; // Final arrival
    duration: string; // Total duration
    link: string;
    flightNumber: string; // Main flight number or "Multi"
    legs: FlightLeg[];
    stopCount: number;
    isDirect: boolean;
}

export interface FlightResult {
    success: boolean;
    offer?: FlightOffer;
    error?: string;
}

/**
 * Helper to extract numeric price from string or number
 */
function extractPriceValue(price: number | string | undefined): number {
    if (price === undefined || price === null) return Infinity;
    if (typeof price === 'number') return price;

    // Handle string: "$120", "₪2,300", "€50"
    // Remove non-numeric chars except dot
    const clean = price.toString().replace(/[^0-9.]/g, '');
    const val = parseFloat(clean);
    return isNaN(val) ? Infinity : val;
}

/**
 * Helper to resolve city name to IATA code
 */
function resolveCityToIATA(input: string): string {
    const cleanInput = input.toLowerCase().trim();
    return CITY_TO_IATA_MAPPING[cleanInput] || input.toUpperCase();
}

/**
 * Get a flight from the origin to a specific or random popular destination
 * for tomorrow or a specific date.
 */
export async function getRandomFlight(
    originInput: string,
    destinationInput?: string,
    outboundDate?: string,
    returnDate?: string,
    maxStops?: number
): Promise<FlightResult> {
    try {
        // Resolve origin to IATA if possible
        const origin = resolveCityToIATA(originInput);
        let destination: string;

        if (destinationInput) {
            destination = resolveCityToIATA(destinationInput);
        } else {
            // Pick a random destination that is NOT the origin
            destination = POPULAR_DESTINATIONS[Math.floor(Math.random() * POPULAR_DESTINATIONS.length)] || 'LHR';
            // Simple protection against same origin-dest
            if (destination === origin) {
                destination = 'LHR'; // Fallback
            }
        }

        // Ensure destination is set (TS check)
        if (!destination) {
            destination = 'LHR';
        }

        // Date Logic
        let dateStr: string;
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

        // Normalize inputs
        let finalOutbound = outboundDate ? normalizeDate(outboundDate) : '';
        let finalReturn = returnDate ? normalizeDate(returnDate) : '';

        if (finalOutbound) {
            if (!dateRegex.test(finalOutbound)) {
                logger.warn(`⚠️ Invalid outbound date format: ${outboundDate} (normalized: ${finalOutbound})`);
                return { success: false, error: `תאריך היציאה "${outboundDate}" אינו תקין. אנא השתמש בפורמט ברור (למשל: 4.12.2025, 4 בדצמבר, או 'שלישי בינואר').` };
            }
            dateStr = finalOutbound;
        } else {
            // Date: Tomorrow default
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            dateStr = tomorrow.toISOString().split('T')[0] || ''; // YYYY-MM-DD
        }

        if (finalReturn && !dateRegex.test(finalReturn)) {
            logger.warn(`⚠️ Invalid return date format: ${returnDate} (normalized: ${finalReturn})`);
            return { success: false, error: `תאריך החזרה "${returnDate}" אינו תקין.` };
        }

        const isRoundTrip = !!returnDate;
        const type = isRoundTrip ? '1' : '2'; // 1 = Round Trip, 2 = One Way

        logger.info(`✈️ Searching flights: ${origin} -> ${destination} on ${dateStr}${isRoundTrip ? ` returning ${returnDate}` : ''}`);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const params: any = {
            engine: 'google_flights',
            departure_id: origin,
            arrival_id: destination,
            outbound_date: dateStr,
            currency: 'ILS',
            hl: 'iw', // Hebrew interface/language
            api_key: SERPAPI_KEY,
            type: type
        };

        if (maxStops !== undefined && maxStops !== null) {
            // SerpApi mapping: 1 = Nonstop, 2 = 1 Stop, 3 = 2 Stops
            // Tool mapping: 0 = Direct, 1 = 1 Stop, 2 = 2 Stops
            params.stops = maxStops + 1;
        }

        if (isRoundTrip && returnDate) {
            params.return_date = returnDate;
        }

        const response = await axios.get('https://serpapi.com/search.json', { params });

        // Check 'best_flights' and 'other_flights'
        const bestFlights = response.data?.best_flights || [];
        const otherFlights = response.data?.other_flights || [];
        const allFlights = [...bestFlights, ...otherFlights];

        if (allFlights.length === 0) {
            logger.warn(`⚠️ No flights found from ${origin} to ${destination}`);
            return {
                success: false,
                error: `לא נמצאו טיסות ישירות או נוחות מ${origin} ל${destination} לתאריך ${dateStr}. נסה יעד אחר?`
            };
        }

        // Sort by Lowest Price
        allFlights.sort((a, b) => {
            const priceA = extractPriceValue(a.price);
            const priceB = extractPriceValue(b.price);
            return priceA - priceB;
        });

        // Log top 3 candidates for debugging
        const topCandidates = allFlights.slice(0, 3).map((f: any) => `${f.price} (${f.total_duration}m)`);
        logger.info(`💰 Top 3 cheapest flights found: ${topCandidates.join(', ')}`);

        // Pick the first one (Cheapest)
        const flight = allFlights[0];

        // Extract legs
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawLegs = flight.flights || [];
        const legs: FlightLeg[] = rawLegs.map((leg: any) => ({
            origin: leg.departure_airport?.name || leg.departure_airport?.id,
            destination: leg.arrival_airport?.name || leg.arrival_airport?.id,
            originCode: leg.departure_airport?.id,
            destinationCode: leg.arrival_airport?.id,
            airline: leg.airline || 'Unknown',
            flightNumber: leg.flight_number || '',
            departureTime: leg.departure_airport?.time || '',
            arrivalTime: leg.arrival_airport?.time || '',
            duration: `${Math.floor(leg.duration / 60)}h ${leg.duration % 60}m`
        }));

        const firstLeg = rawLegs[0];
        const lastLeg = rawLegs[rawLegs.length - 1];

        // Extract price
        const price = flight.price ? (typeof flight.price === 'number' ? `₪${flight.price}` : flight.price) : 'מחיר לא זמין';

        const validDestination = destination || 'LHR';
        const cityName = IATA_TO_CITY_NAME[validDestination] || validDestination;
        const airportName = lastLeg.arrival_airport?.name || validDestination;
        const formattedDestination = `${cityName} (${airportName})`;

        const airlineName = legs.length === 1 ? firstLeg.airline : (Array.from(new Set(legs.map(l => l.airline))).join(', '));

        return {
            success: true,
            offer: {
                destination: formattedDestination,
                airline: airlineName,
                price: price || 'Price unavailable',
                departureTime: firstLeg.departure_airport?.time || '???',
                arrivalTime: lastLeg.arrival_airport?.time || '???',
                duration: `${Math.floor(flight.total_duration / 60)}h ${flight.total_duration % 60}m`,
                link: (response.data.search_metadata?.google_flights_url as string) || '',
                flightNumber: legs.length === 1 ? firstLeg.flight_number : `${legs.length} legs`,
                legs: legs,
                stopCount: legs.length - 1,
                isDirect: legs.length === 1
            }
        };

    } catch (error: any) {
        logger.error('❌ Error fetching flights:', error.message);

        let userMessage = 'אירעה שגיאה בחיפוש הטיסה. אנא נסה שוב מאוחר יותר.';

        if (error.response?.status === 400) {
            userMessage = `שגיאה בפרטי החיפוש (יעד או תאריך). ייתכן שהיעד אינו מזוהה או שהתאריכים אינם תקינים (למשל תאריך עבר).`;
        }

        return { success: false, error: userMessage };
    }
}
