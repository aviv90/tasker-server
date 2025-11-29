/**
 * Kie Service Mock
 * Mock implementation of Kie.ai service for tests
 */

export const mockKieService = {
  generateVideoWithText: jest.fn().mockResolvedValue({
    videoBuffer: Buffer.from('mock-kie-video-data'),
    text: 'Mock Kie video generated',
    cost: 0.03
  }),

  generateVideoWithImage: jest.fn().mockResolvedValue({
    videoBuffer: Buffer.from('mock-kie-video-from-image-data'),
    text: 'Mock Kie video from image generated',
    cost: 0.03
  })
};

// Default export for convenience
export default mockKieService;

