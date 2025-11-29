/**
 * Voice Service Mock
 * Mock implementation of Voice service (ElevenLabs) for tests
 */

export const mockVoiceService = {
  initializeClient: jest.fn().mockReturnValue({
    // Mock ElevenLabs client
  }),

  createInstantVoiceClone: jest.fn().mockResolvedValue({
    voiceId: 'mock-voice-id',
    success: true
  }),

  getAvailableOptions: jest.fn().mockReturnValue({
    languages: ['en', 'he'],
    voices: ['default']
  }),

  getVoices: jest.fn().mockResolvedValue([
    { voiceId: 'voice1', name: 'Voice 1' },
    { voiceId: 'voice2', name: 'Voice 2' }
  ]),

  getVoice: jest.fn().mockResolvedValue({
    voiceId: 'mock-voice-id',
    name: 'Mock Voice',
    description: 'Mock voice description'
  }),

  deleteVoice: jest.fn().mockResolvedValue({
    success: true
  }),

  generateTextToSpeech: jest.fn().mockResolvedValue({
    audioBuffer: Buffer.from('mock-tts-audio-data'),
    voiceId: 'mock-voice-id'
  }),

  selectVoiceForLanguage: jest.fn().mockReturnValue('mock-voice-id')
};

// Default export for convenience
export default mockVoiceService;

