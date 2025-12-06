
import { searchAmazon } from '../../services/serpApi/amazonSearch';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Amazon Search Service', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should fetch and parse Amazon search results successfully', async () => {
        const mockResponse = {
            data: {
                organic_results: [
                    {
                        title: 'Test Product 1',
                        price: '$19.99',
                        thumbnail: 'http://image.com/1.jpg',
                        link: 'http://amazon.com/dp/12345',
                        rating: 4.5,
                        reviews: 100
                    },
                    {
                        title: 'Test Product 2',
                        price: '$29.99',
                        thumbnail: 'http://image.com/2.jpg',
                        link: 'http://amazon.com/dp/67890'
                    }
                ]
            }
        };

        mockedAxios.get.mockResolvedValue(mockResponse);

        const result = await searchAmazon('test query');

        expect(result.success).toBe(true);
        expect(result.products).toHaveLength(2);
        expect(result.products![0].title).toBe('Test Product 1');
        expect(result.products![0].price).toBe('$19.99');
        expect(mockedAxios.get).toHaveBeenCalledWith('https://serpapi.com/search.json', expect.any(Object));
    });

    it('should handle empty results gracefully', async () => {
        mockedAxios.get.mockResolvedValue({ data: { organic_results: [] } });

        const result = await searchAmazon('non-existent product');

        expect(result.success).toBe(false);
        expect(result.error).toContain('לא נמצאו מוצרים');
    });

    it('should handle API errors gracefully', async () => {
        mockedAxios.get.mockRejectedValue(new Error('API Error'));

        const result = await searchAmazon('error query');

        expect(result.success).toBe(false);
        expect(result.error).toBe('API Error');
    });
});
