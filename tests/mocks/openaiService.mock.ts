/**
 * OpenAI Service Mock
 * Mock implementation of OpenAI service for tests
 */

export const mockOpenaiService = {
  generateImageWithText: jest.fn().mockResolvedValue({
    imageBuffer: Buffer.from('mock-openai-image-data'),
    text: 'Mock OpenAI image generated',
    cost: 0.02
  }),

  generateVideoWithSora: jest.fn().mockResolvedValue({
    videoBuffer: Buffer.from('mock-openai-video-data'),
    text: 'Mock OpenAI video generated',
    cost: 0.05
  }),

  generateTextResponse: jest.fn().mockResolvedValue({
    text: 'Mock OpenAI text response',
    metadata: {
      service: 'openai',
      model: 'gpt-4o',
      characterCount: 30
    }
  }),

  editImageWithText: jest.fn().mockResolvedValue({
    imageBuffer: Buffer.from('mock-openai-edited-image-data'),
    text: 'Mock OpenAI image edited',
    cost: 0.02
  })
};

// Default export for convenience
export default mockOpenaiService;

