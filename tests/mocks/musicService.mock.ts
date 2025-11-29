/**
 * Music Service Mock
 * Mock implementation of Music service for tests
 */

export const mockMusicService = {
  generateMusicWithLyrics: jest.fn().mockResolvedValue({
    audioBuffer: Buffer.from('mock-music-audio-data'),
    text: 'Mock music with lyrics generated',
    metadata: {
      title: 'Mock Song',
      duration: 30,
      tags: ['pop', 'happy'],
      model: 'V4_5',
      type: 'vocal'
    }
  }),

  generateInstrumentalMusic: jest.fn().mockResolvedValue({
    audioBuffer: Buffer.from('mock-instrumental-audio-data'),
    text: 'Mock instrumental music generated',
    metadata: {
      title: 'Mock Instrumental',
      duration: 30,
      tags: ['instrumental', 'ambient'],
      model: 'V4_5',
      type: 'instrumental'
    }
  }),

  generateAdvancedMusic: jest.fn().mockResolvedValue({
    audioBuffer: Buffer.from('mock-advanced-music-audio-data'),
    text: 'Mock advanced music generated',
    metadata: {
      title: 'Mock Advanced Song',
      duration: 60,
      tags: ['advanced', 'custom'],
      model: 'V5',
      type: 'vocal'
    }
  })
};

// Default export for convenience
export default mockMusicService;

