import { getRandomFlight } from '../services/serpApi/googleFlights';


async function test() {
    // Get arguments
    const originInput = process.argv[2] || 'TLV';
    const destinationInput = process.argv[3]; // Optional
    const outboundDate = process.argv[4]; // Optional
    const returnDate = process.argv[5]; // Optional

    console.log(`🔍 Testing flight search from: ${originInput} to ${destinationInput || 'Random'} on ${outboundDate || 'Tomorrow'} (Input raw)`);

    try {
        const result = await getRandomFlight(originInput, destinationInput, outboundDate, returnDate);

        if (result.success && result.offer) {
            console.log('✅ Success!');
            console.log('--------------------------------');
            console.log('Destination:', result.offer.destination);
            console.log('Stops:', result.offer.stopCount);
            console.log('Direct:', result.offer.isDirect);
            console.log('Legs:', JSON.stringify(result.offer.legs, null, 2));
            console.log('Airline:', result.offer.airline);
            console.log('Price:', result.offer.price);
            console.log('Departure:', result.offer.departureTime);
            console.log('Arrival:', result.offer.arrivalTime);
            console.log('Duration:', result.offer.duration);
            console.log('Flight #:', result.offer.flightNumber);
            console.log('Link:', result.offer.link);
            console.log('--------------------------------');
        } else {
            console.error('❌ Failed:', result.error);
        }
    } catch (error) {
        console.error('❌ Exception:', error);
    }
}

test();
