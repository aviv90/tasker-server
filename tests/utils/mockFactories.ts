/**
 * Mock Factories
 * Factories for creating mock data in tests
 */

import { v4 as uuidv4 } from 'uuid';
import { generateChatId, generateMessageId } from './testHelpers';

/**
 * Create a mock command data object
 */
export function createMockCommandData(overrides: Record<string, unknown> = {}) {
  return {
    chatId: generateChatId(),
    messageId: generateMessageId(),
    tool: 'test_tool',
    toolArgs: {},
    args: {},
    prompt: 'Test prompt',
    failed: false,
    timestamp: Date.now(),
    ...overrides
  };
}

/**
 * Create a mock contact object
 */
export function createMockContact(overrides: Record<string, unknown> = {}) {
  return {
    id: uuidv4(),
    name: 'Test Contact',
    type: 'user',
    phone: '+1234567890',
    ...overrides
  };
}

/**
 * Create a mock task data object
 */
export function createMockTaskData(overrides: Record<string, unknown> = {}) {
  return {
    taskId: uuidv4(),
    status: 'pending' as const,
    result: null,
    error: null,
    ...overrides
  };
}

/**
 * Create a mock agent result
 */
export function createMockAgentResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    text: 'Test response',
    toolsUsed: [],
    toolCalls: [],
    toolResults: {},
    ...overrides
  };
}

/**
 * Create a mock WhatsApp webhook data
 */
export function createMockWhatsAppWebhook(overrides: Record<string, unknown> = {}) {
  return {
    type: 'incomingMessageReceived',
    timestamp: Date.now(),
    idMessage: generateMessageId(),
    messageData: {
      typeMessage: 'textMessage',
      textMessageData: {
        textMessage: 'Test message'
      }
    },
    senderData: {
      sender: '+1234567890',
      senderName: 'Test User',
      chatId: generateChatId()
    },
    ...overrides
  };
}

/**
 * Create a mock conversation message
 */
export function createMockMessage(overrides: Record<string, unknown> = {}) {
  return {
    role: 'user',
    content: 'Test message',
    timestamp: Date.now(),
    metadata: {},
    ...overrides
  };
}

/**
 * Create a mock image generation result
 */
export function createMockImageResult(overrides: Record<string, unknown> = {}) {
  return {
    imageBuffer: Buffer.from('fake-image-data'),
    text: 'Test image',
    cost: 0.01,
    ...overrides
  };
}

/**
 * Create a mock video generation result
 */
export function createMockVideoResult(overrides: Record<string, unknown> = {}) {
  return {
    videoBuffer: Buffer.from('fake-video-data'),
    text: 'Test video',
    cost: 0.02,
    ...overrides
  };
}

/**
 * Create a mock audio generation result
 */
export function createMockAudioResult(overrides: Record<string, unknown> = {}) {
  return {
    audioBuffer: Buffer.from('fake-audio-data'),
    text: 'Test audio',
    cost: 0.01,
    ...overrides
  };
}

