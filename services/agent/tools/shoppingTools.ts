import * as amazonSearch from '../../serpApi/amazonSearch';
import logger from '../../../utils/logger';
import { createTool } from './base';

interface AmazonArgs {
    topic?: string;
}

const GENERIC_SEARCH_TERMS = [
    'cool gadgets',
    'funny gifts',
    'bestsellers electronics',
    'unique home decor',
    'weird stuff',
    'trending toys',
    'kitchen gadgets under 50',
    'office desk accessories',
    'smart home devices',
    'outdoor camping gear'
];

export const random_amazon_product = createTool<AmazonArgs>(
    {
        name: 'random_amazon_product',
        description: 'Find a random product on Amazon. Use this when the user asks for a "random product", "gift idea", "something cool from Amazon", or a specific type of random item (e.g. "random toy").',
        parameters: {
            type: 'object',
            properties: {
                topic: {
                    type: 'string',
                    description: 'Optional topic/category. If user says "random toy", topic is "toy". If user says "random product", leave empty/null.'
                }
            },
            required: []
        }
    },
    async (args) => {
        try {
            let query = args.topic;

            // randomness logic
            if (!query || query.trim() === '') {
                // Pick random generic term
                query = GENERIC_SEARCH_TERMS[Math.floor(Math.random() * GENERIC_SEARCH_TERMS.length)];
                logger.info(`🎲 [Amazon Tool] No topic provided, picked random query: "${query}"`);
            } else {
                logger.info(`🎯 [Amazon Tool] User requested topic: "${query}"`);
            }

            const result = await amazonSearch.searchAmazon(query || 'best selling products');

            if (!result.success || !result.products || result.products.length === 0) {
                return {
                    success: false,
                    error: result.error || 'Failed to find products.'
                };
            }

            // Pick a random product from results
            const products = result.products;
            const randomProduct = products[Math.floor(Math.random() * products.length)];

            if (!randomProduct) {
                return {
                    success: false,
                    error: 'Failed to select a random product.'
                };
            }

            logger.info(`📦 [Amazon Tool] Selected product: ${randomProduct.title.substring(0, 50)}...`);

            // Build message
            // Note: We use * * for bold in WhatsApp/Markdown
            const msg = `📦 *מוצר אקראי מאמזון:*\n\n🎁 *${randomProduct.title}*\n\n💰 *מחיר:* ${randomProduct.price || 'לא ידוע'}\n⭐ *דירוג:* ${randomProduct.rating || 'N/A'} (${randomProduct.reviews || 0} ביקורות)\n\n[לרכישה ופרטים נוספים](${randomProduct.link})`;

            return {
                success: true,
                data: msg,
                product: randomProduct,
                imageUrl: randomProduct.image
            };

        } catch (error: any) {
            logger.error('❌ Error in random_amazon_product tool:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }
);
