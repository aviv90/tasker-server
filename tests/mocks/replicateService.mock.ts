/**
 * Replicate Service Mock
 * Mock implementation of Replicate service for tests
 */

export const mockReplicateService = {
  generateVideoWithText: jest.fn().mockResolvedValue({
    text: 'Mock Replicate video generated',
    result: 'https://example.com/mock-replicate-video.mp4',
    cost: '0.03'
  }),

  generateVideoFromImage: jest.fn().mockResolvedValue({
    text: 'Mock Replicate video from image generated',
    result: 'https://example.com/mock-replicate-video-from-image.mp4',
    cost: '0.03'
  }),

  generateVideoFromVideo: jest.fn().mockResolvedValue({
    result: 'https://example.com/mock-replicate-video-from-video.mp4',
    error: undefined
  }),

  generateVideoWithTextForWhatsApp: jest.fn().mockResolvedValue({
    success: true,
    videoUrl: 'https://example.com/mock-replicate-video.mp4',
    description: 'Mock Replicate video description',
    fileName: 'mock-video.mp4'
  }),

  generateVideoFromImageForWhatsApp: jest.fn().mockResolvedValue({
    success: true,
    videoUrl: 'https://example.com/mock-replicate-video-from-image.mp4',
    description: 'Mock Replicate video from image description',
    fileName: 'mock-video-from-image.mp4'
  }),

  generateVideoFromVideoForWhatsApp: jest.fn().mockResolvedValue({
    success: true,
    videoUrl: 'https://example.com/mock-replicate-video-from-video.mp4',
    description: 'Mock Replicate video from video description',
    fileName: 'mock-video-from-video.mp4'
  })
};

// Default export for convenience
export default mockReplicateService;

