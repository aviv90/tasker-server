
import * as googleFlights from '../../../serpApi/googleFlights';
import logger from '../../../../utils/logger';

import { createTool } from '../base';

interface FlightArgs {
    origin: string;
    destination?: string;
    date?: string;
    return_date?: string;
    max_stops?: number;
}

export const random_flight = createTool<FlightArgs>(
    {
        name: 'random_flight',
        description: 'Find a flight from a specific origin to a destination (optional). Supports specific dates or date ranges. If a range is given (e.g. "between 2nd and 5th"), use the start date as the flight date.',
        parameters: {
            type: 'object',
            properties: {
                origin: {
                    type: 'string',
                    description: 'The 3-letter IATA airport code (e.g., "TLV" for Tel Aviv, "LHR" for London). You MUST convert the user\'s city name to the correct IATA code.',
                },
                destination: {
                    type: 'string',
                    description: 'The 3-letter IATA airport code for the destination (e.g., "CPH" for Copenhagen, "NYC" for New York). You MUST convert the city name to IATA. If not provided, a random destination is chosen.',
                },
                date: {
                    type: 'string',
                    description: 'The outbound flight date. Optional. MUST be in YYYY-MM-DD format (e.g. "2025-12-01"). If not provided, defaults to tomorrow.',
                },
                return_date: {
                    type: 'string',
                    description: 'The return flight date. Required for round trips. MUST be in YYYY-MM-DD format. Calculate based on user input: 1. Explicit ("return on 10th") -> 2025-12-10. 2. Duration ("for a week") -> Calculate outbound_date + 7 days. 3. Range ("From 2nd to 10th") -> Use END date.',
                },
                max_stops: {
                    type: 'integer',
                    description: 'Optional: Maximum number of stops/connections. 0 = direct/nonstop. 1 = up to 1 stop. 2 = up to 2 stops. If user says "direct" or "nonstop", use 0. If user says "1 stop", use 1. If unspecified, do not send.'
                }
            },
            required: ['origin']
        }
    },
    async (args) => {
        // Default date to tomorrow if not provided
        let targetDate = args.date;
        if (!targetDate) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            // Format as YYYY-MM-DD
            targetDate = tomorrow.toISOString().split('T')[0];
        }

        logger.info(`✈️ [Agent Tool] random_flight called for origin: ${args.origin}, dest: ${args.destination || 'random'}, date: ${targetDate} (original: ${args.date || 'none'}), stops: ${args.max_stops !== undefined ? args.max_stops : 'any'}`);

        try {
            if (!args.origin) {
                return {
                    success: false,
                    error: 'Please provide an origin for the flight.'
                };
            }

            const result = await googleFlights.getRandomFlight(args.origin, args.destination, targetDate, args.return_date, args.max_stops);

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
✈️ *חברת תעופה:* ${offer.airline}`;

            return {
                success: true,
                data: message,
                // flightResult property is not in standard ToolResult, but we can verify if we need to extend ToolResult or put it in data
                // For now, ToolResult in types.ts has [key: string]: unknown, so it should be fine.
                flightResult: offer
            };

        } catch (error: unknown) {
            const err = error as Error;
            logger.error('❌ Error in random_flight tool:', err.message);
            return {
                success: false,
                error: err.message
            };
        }
    }
);
