
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
        description: 'Find a random flight for tomorrow from a specific origin to a popular destination. Use this when the user asks for a flight or "send a flight".',
        parameters: {
            type: 'object',
            properties: {
                origin: {
                    type: 'string',
                    description: 'The origin airport code or city name (e.g., "TLV", "Tel Aviv", "JFK")',
                }
            },
            required: ['origin']
        }
    },
    historyContext: {
        ignore: true,
        reason: 'Random flight search should not depend on previous chat history context unless explicitly refining a search. Ignoring history reduces noise.'
    },
    execute: async (args: { origin: string }, _context: unknown): Promise<ToolResult> => {
        logger.info(`✈️ [Agent Tool] random_flight called for origin: ${args.origin}`);

        try {
            if (!args.origin) {
                return {
                    success: false,
                    error: 'Please provide an origin for the flight.'
                };
            }

            const result = await googleFlights.getRandomFlight(args.origin);

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
