import logger from '../utils/logger';
import { getRandomFlight } from '../services/serpApi/googleFlights';


async function test() {
    // Get arguments
    const originInput = process.argv[2] || 'TLV';
    const destinationInput = process.argv[3]; // Optional
    const outboundDate = process.argv[4]; // Optional
    const returnDate = process.argv[5]; // Optional
    const maxStops = process.argv[6] ? parseInt(process.argv[6]) : undefined;

    logger.info(`🔍 Testing flight search from: ${originInput} to ${destinationInput || 'Random'} on ${outboundDate || 'Tomorrow'}, stops: ${maxStops !== undefined ? maxStops : 'Any'}`);

    try {
        const result = await getRandomFlight(originInput, destinationInput, outboundDate, returnDate, maxStops);

        if (result.success && result.offer) {
            logger.info('✅ Success!');
            logger.info('--------------------------------');
            logger.info(`Destination: ${result.offer.destination}`);
            logger.info(`Stops: ${result.offer.stopCount}`);
            logger.info(`Direct: ${result.offer.isDirect}`);
            logger.info(`Legs: ${JSON.stringify(result.offer.legs, null, 2)}`);
            logger.info(`Airline: ${result.offer.airline}`);
            logger.info(`Price: ${result.offer.price}`);
            logger.info(`Departure: ${result.offer.departureTime}`);
            logger.info(`Arrival: ${result.offer.arrivalTime}`);
            logger.info(`Duration: ${result.offer.duration}`);
            logger.info(`Flight #: ${result.offer.flightNumber}`);
            logger.info(`Link: ${result.offer.link}`);
            logger.info('--------------------------------');
        } else {
            logger.error(`❌ Failed: ${result.error}`);
        }
    } catch (error) {
        logger.error(`❌ Exception: ${error}`);
    }
}

test();
