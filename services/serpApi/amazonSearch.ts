import axios from 'axios';
import logger from '../../utils/logger';
import config from '../../config/env';

import { API_URLS } from '../../utils/constants';

const SERPAPI_KEY = config.ai.serpApi.apiKey;

export interface AmazonProduct {
    title: string;
    price: string;
    currency?: string;
    link: string;
    image: string;
    rating?: number;
    reviews?: number;
    asin?: string;
}

export interface AmazonSearchResult {
    success: boolean;
    products?: AmazonProduct[];
    error?: string;
}

/**
 * Search Amazon via SerpApi
 * @param query - Search term
 * @param domain - Amazon domain (default: amazon.com)
 */
export async function searchAmazon(query: string, domain: string = 'amazon.com'): Promise<AmazonSearchResult> {
    try {
        logger.info(`🛒 Searching Amazon (${domain}) for: ${query}`);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const params: any = {
            engine: 'amazon',
            q: query, // Sending both to be safe, but 'q' is often standard alias
            k: query, // Explicitly required by some SerpApi backends for Amazon
            api_key: SERPAPI_KEY,
            domain: domain
        };

        const response = await axios.get(API_URLS.SERPAPI, { params });

        // SerpApi returns organic_results
        const results = response.data?.organic_results || [];

        if (results.length === 0) {
            logger.warn(`⚠️ No products found for query: ${query}`);
            return {
                success: false,
                error: `לא נמצאו מוצרים עבור "${query}".`
            };
        }

        // Map to simplified structure
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const products: AmazonProduct[] = results.map((item: any) => ({
            title: item.title,
            price: item.price,
            currency: item.currency,
            link: item.link,
            image: item.thumbnail,
            rating: item.rating,
            reviews: item.reviews,
            asin: item.asin
        }));

        return {
            success: true,
            products: products
        };

    } catch (error: any) {
        logger.error('❌ Error searching Amazon:', error.message);
        if (error.response?.data) {
            logger.error('🔍 API Error Details:', error.response.data);
        }
        return {
            success: false,
            error: error.message
        };
    }
}
