
import * as googleFlights from '../../../serpApi/googleFlights';
import logger from '../../../../utils/logger';

interface ToolResult {
    success: boolean;
    data?: string;
    error?: string;
    flightResult?: googleFlights.FlightOffer;
    [key: string]: unknown;
}

export const random_flight = {
    declaration: {
        name: 'random_flight',
        description: 'Find a flight from a specific origin to a destination (optional). Supports specific dates or date ranges. If a range is given (e.g. "between 2nd and 5th"), use the start date as the flight date.',
        parameters: {
            type: 'object',
            properties: {
                origin: {
                    type: 'string',
                    description: 'The origin airport code or city name (e.g., "TLV", "Tel Aviv")',
                },
                destination: {
                    type: 'string',
                    description: 'The destination airport code or city name (optional) (e.g., "London", "LHR"). If not provided, a random destination is chosen.',
                },
                date: {
                    type: 'string',
                    description: 'The outbound flight date. Ideally YYYY-MM-DD. Supports natural language ("4.12", "shniym be-ianuar", "next friday"). For ranges ("from 2nd to 5th"), use the START date here.',
                },
                return_date: {
                    type: 'string',
                    description: 'The return flight date. Required for round trips. Calculate based on user input: 1. Explicit ("return on 10th") -> 2025-12-10. 2. Duration ("for a week", "for 5 days") -> Calculate date + duration. 3. Range ("From 2nd to 10th") -> Use END date here (10th).',
                }
            },
            required: ['origin']
        }
    },
    // ... historyContext ...
    execute: async (args: { origin: string; destination?: string; date?: string; return_date?: string }, _context: unknown): Promise<ToolResult> => {
        logger.info(`✈️ [Agent Tool] random_flight called for origin: ${args.origin}, dest: ${args.destination || 'random'}, date: ${args.date || 'tomorrow'}`);

        try {
            if (!args.origin) {
                return {
                    success: false,
                    error: 'Please provide an origin for the flight.'
                };
            }

            const result = await googleFlights.getRandomFlight(args.origin, args.destination, args.date, args.return_date);

            if (!result.success || !result.offer) {
                return {
                    success: false,
                    error: result.error || 'Failed to find a flight.'
                };
            }

            const offer = result.offer;
            let flightDetails = `*המראה:* ${offer.departureTime}\n🛬 *נחיתה:* ${offer.arrivalTime}\n⏳ *משך כולל:* ${offer.duration}`;

            if (!offer.isDirect) {
                flightDetails += `\n\n🛑 *מספר עצירות:* ${offer.stopCount}`;

                // Add itinerary details
                flightDetails += `\n\n📜 *מסלול הטיסה:*`;
                offer.legs.forEach((leg, index) => {
                    flightDetails += `\n${index + 1}. *${leg.originCode}* ➝ *${leg.destinationCode}* (${leg.duration})`;
                    flightDetails += `\n   ✈️ ${leg.airline} (${leg.flightNumber})`;

                    // Calculate layover if not the last leg
                    if (index < offer.legs.length - 1) {
                        // Simple layover visual separator
                        flightDetails += `\n   ⏳ _קונקשן ב-${leg.destination}_`;
                    }
                });
            } else {
                flightDetails += `\n\n✅ *טיסה ישירה*`;
            }

            const message = `✈️ מצאתי טיסה!
        
📍 *יעד:* ${offer.destination}
💰 *מחיר:* ${offer.price}
🛫 ${flightDetails}
✈️ *חברת תעופה:* ${offer.airline}

[לפרטים נוספים והזמנה](${offer.link})`;

            return {
                success: true,
                data: message,
                flightResult: offer
            };

        } catch (error: any) {
            logger.error('❌ Error in random_flight tool:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }
};
