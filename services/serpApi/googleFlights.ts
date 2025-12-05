
import axios from 'axios';
import logger from '../../utils/logger';

const SERPAPI_KEY = '4bb8d1938d69ca8c557e4da41e1f2d2079ac81f08536fbf0b66051bcb63b8a4c';
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

export interface FlightOffer {
    destination: string;
    airline: string;
    price: string;
    departureTime: string;
    arrivalTime: string;
    duration: string;
    link: string;
    flightNumber: string;
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
export async function getRandomFlight(origin: string): Promise<FlightResult> {
    try {
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
        const leg = flight.flights[0]; // First leg

        // Extract price - sometimes it's just an integer, sometimes formatted
        const price = flight.price ? (typeof flight.price === 'number' ? `₪${flight.price}` : flight.price) : 'מחיר לא זמין';

        return {
            success: true,
            offer: {
                destination: destination || 'Unknown',
                airline: leg.airline || 'Unknown Airline',
                price: price || 'Price unavailable',
                departureTime: leg.departure_airport?.time || '???',
                arrivalTime: leg.arrival_airport?.time || '???',
                duration: `${Math.floor(flight.total_duration / 60)}h ${flight.total_duration % 60}m`,
                link: (response.data.search_metadata?.google_flights_url as string) || '',
                flightNumber: leg.flight_number || ''
            }
        };

    } catch (error: any) {
        logger.error('❌ Error fetching flights:', error.message);
        return { success: false, error: error.message };
    }
}
