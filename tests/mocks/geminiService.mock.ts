/**
 * Gemini Service Mock
 * Mock implementation of Gemini service for tests
 */

export const mockGeminiService = {
  generateTextResponse: jest.fn().mockResolvedValue({
    text: 'Mock Gemini text response',
    metadata: {
      service: 'gemini',
      model: 'gemini-2.5-flash',
      characterCount: 25
    }
  }),

  generateImageWithText: jest.fn().mockResolvedValue({
    imageBuffer: Buffer.from('mock-image-data'),
    text: 'Mock image generated',
    cost: 0.01
  }),

  generateImageForWhatsApp: jest.fn().mockResolvedValue({
    success: true,
    imageUrl: 'https://example.com/mock-image.png',
    description: 'Mock image description'
  }),

  editImageWithText: jest.fn().mockResolvedValue({
    imageBuffer: Buffer.from('mock-edited-image-data'),
    text: 'Mock image edited',
    cost: 0.01
  }),

  editImageForWhatsApp: jest.fn().mockResolvedValue({
    success: true,
    imageUrl: 'https://example.com/mock-edited-image.png',
    description: 'Mock edited image description'
  }),

  analyzeImageWithText: jest.fn().mockResolvedValue({
    text: 'Mock image analysis',
    metadata: {
      service: 'gemini',
      model: 'gemini-2.5-flash'
    }
  }),

  generateVideoWithText: jest.fn().mockResolvedValue({
    videoBuffer: Buffer.from('mock-video-data'),
    text: 'Mock video generated',
    cost: 0.02
  }),

  generateVideoWithImage: jest.fn().mockResolvedValue({
    videoBuffer: Buffer.from('mock-video-data'),
    text: 'Mock video from image generated',
    cost: 0.02
  }),

  generateVideoForWhatsApp: jest.fn().mockResolvedValue({
    success: true,
    videoUrl: 'https://example.com/mock-video.mp4',
    description: 'Mock video description'
  }),

  generateVideoFromImageForWhatsApp: jest.fn().mockResolvedValue({
    success: true,
    videoUrl: 'https://example.com/mock-video-from-image.mp4',
    description: 'Mock video from image description'
  }),

  analyzeVideoWithText: jest.fn().mockResolvedValue({
    text: 'Mock video analysis',
    metadata: {
      service: 'gemini',
      model: 'gemini-2.5-flash'
    }
  }),

  generateChatSummary: jest.fn().mockResolvedValue({
    summary: 'Mock chat summary',
    keyTopics: ['topic1', 'topic2']
  }),

  translateText: jest.fn().mockResolvedValue({
    text: 'Mock translated text',
    sourceLanguage: 'en',
    targetLanguage: 'he'
  }),

  parseMusicRequest: jest.fn().mockResolvedValue({
    prompt: 'Mock music prompt',
    style: 'pop',
    duration: 30
  }),

  parseTextToSpeechRequest: jest.fn().mockResolvedValue({
    text: 'Mock TTS text',
    language: 'he',
    voice: 'default'
  }),

  generateCreativePoll: jest.fn().mockResolvedValue({
    question: 'Mock poll question',
    options: ['Option 1', 'Option 2', 'Option 3']
  }),

  getLocationInfo: jest.fn().mockResolvedValue({
    formatted_address: 'Mock Location Address',
    lat: 31.7683,
    lng: 35.2137
  }),

  getLocationBounds: jest.fn().mockResolvedValue({
    northeast: { lat: 32.0, lng: 35.5 },
    southwest: { lat: 31.5, lng: 35.0 }
  })
};

// Default export for convenience
export default mockGeminiService;

