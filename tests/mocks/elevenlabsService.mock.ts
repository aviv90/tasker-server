/**
 * ElevenLabs Service Mock
 * Mock implementation of ElevenLabs service for tests
 */

export const mockElevenlabsService = {
  transcribeAudio: jest.fn().mockResolvedValue({
    text: 'Mock transcribed text',
    language: 'en',
    confidence: 0.95
  }),

  generateSpeech: jest.fn().mockResolvedValue({
    audioBuffer: Buffer.from('mock-speech-audio-data'),
    voiceId: 'mock-voice-id'
  }),

  getVoices: jest.fn().mockResolvedValue([
    { voiceId: 'voice1', name: 'Voice 1', language: 'en' },
    { voiceId: 'voice2', name: 'Voice 2', language: 'he' }
  ])
};

// Default export for convenience
export default mockElevenlabsService;

