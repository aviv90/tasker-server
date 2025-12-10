
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

/**
 * Normalizes date input to YYYY-MM-DD
 * NOTE: We now rely on the LLM to strictly provide YYYY-MM-DD.
 * This function basically just validates the format.
 */
function normalizeDate(input: string): string {
    const clean = input.trim();
    if (!clean) return '';

    // Strict YYYY-MM-DD validation
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
        return clean;
    }

    // If strictly invalid, we return trimmed input and let the caller fail/warn
    return clean;
}

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
 * Now relies on Agent/LLM to provide the IATA code.
 */
function resolveCityToIATA(input: string): string {
    return input.toUpperCase().trim();
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
        const finalOutbound = outboundDate ? normalizeDate(outboundDate) : '';
        const finalReturn = returnDate ? normalizeDate(returnDate) : '';

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
        const airportName = lastLeg.arrival_airport?.name || validDestination;
        const formattedDestination = `${validDestination} (${airportName})`;

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

        if (error.response?.data) {
            logger.error('🔍 Flight API Error Details:', error.response.data);
        }

        let userMessage = 'אירעה שגיאה בחיפוש הטיסה. אנא נסה שוב מאוחר יותר.';

        if (error.response?.status === 400) {
            userMessage = `שגיאה בפרטי החיפוש (יעד או תאריך). ייתכן שהיעד אינו מזוהה או שהתאריכים אינם תקינים (למשל תאריך עבר).`;
        }

        return { success: false, error: userMessage };
    }
}
