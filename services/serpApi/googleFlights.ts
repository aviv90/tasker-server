
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
};

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
    'TLV': 'תל אביב'
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
 * Get a random flight from the origin to a random popular destination
 * for tomorrow.
 */
export async function getRandomFlight(originInput: string): Promise<FlightResult> {
    try {
        // Resolve origin to IATA if possible
        const cleanOrigin = originInput.toLowerCase().trim();
        const origin = CITY_TO_IATA_MAPPING[cleanOrigin] || originInput.toUpperCase();

        // Pick a random destination that is NOT the origin
        let destination = POPULAR_DESTINATIONS[Math.floor(Math.random() * POPULAR_DESTINATIONS.length)];
        // Simple protection against same origin-dest (though unlikely with city codes vs airport codes usually mixed, but good practice)
        if (destination === origin) {
            destination = 'LHR'; // Fallback
        }

        // Date: Tomorrow
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dateStr = tomorrow.toISOString().split('T')[0]; // YYYY-MM-DD

        logger.info(`✈️ Searching flights: ${origin} -> ${destination} on ${dateStr}`);



        const params = {
            engine: 'google_flights',
            departure_id: origin,
            arrival_id: destination,
            outbound_date: dateStr,
            currency: 'ILS',
            hl: 'iw', // Hebrew interface/language
            api_key: SERPAPI_KEY,
            type: '2' // One way
        };

        const response = await axios.get('https://serpapi.com/search.json', { params });

        // Check 'best_flights' and 'other_flights'
        const bestFlights = response.data.best_flights || [];
        const otherFlights = response.data.other_flights || [];
        const allFlights = [...bestFlights, ...otherFlights];

        if (allFlights.length === 0) {
            logger.warn(`⚠️ No flights found from ${origin} to ${destination}`);
            return {
                success: false,
                error: `לא נמצאו טיסות ישירות או נוחות מ${origin} ל${destination} לתאריך ${dateStr}. נסה יעד אחר?`
            };
        }

        // Pick the first one (usually cheapest/best)
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
        return { success: false, error: error.message };
    }
}
