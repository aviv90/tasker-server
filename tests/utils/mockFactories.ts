/**
 * Mock Factories
 * Factories for creating mock data in tests
 * 
 * Best practices:
 * - Always use factories for complex test data
 * - Override defaults with the 'overrides' parameter
 * - Use type-safe overrides where possible
 */

import { v4 as uuidv4 } from 'uuid';
import { generateChatId, generateMessageId, generateTaskId } from './testHelpers';

// ============================================================================
// Types (for better type safety in tests)
// ============================================================================

export interface MockCommandData {
  chatId: string;
  messageId: string;
  tool: string | null;
  toolArgs: Record<string, unknown>;
  args: Record<string, unknown>;
  prompt: string | null;
  failed: boolean;
  timestamp: number;
}

export interface MockContact {
  id: string;
  name: string;
  type: 'user' | 'group' | 'bot';
  phone: string | null;
}

export interface MockTaskData {
  taskId: string;
  status: 'pending' | 'done' | 'error';
  result: Record<string, unknown> | null;
  error: string | null;
}

export interface MockAgentResult {
  success: boolean;
  text: string | null;
  error?: string;
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  toolsUsed: string[];
  toolCalls: unknown[];
  toolResults: Record<string, unknown>;
  multiStep?: boolean;
  alreadySent?: boolean;
}

export interface MockWhatsAppWebhook {
  type: string;
  timestamp: number;
  idMessage: string;
  messageData: {
    typeMessage: string;
    textMessageData?: { textMessage: string };
    imageMessageData?: { downloadUrl: string };
    videoMessageData?: { downloadUrl: string };
    audioMessageData?: { downloadUrl: string };
  };
  senderData: {
    sender: string;
    senderName: string;
    chatId: string;
  };
}

export interface MockMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata: Record<string, unknown>;
}

// ============================================================================
// Command Factories
// ============================================================================

/**
 * Create a mock command data object
 */
export function createMockCommandData(overrides: Partial<MockCommandData> = {}): MockCommandData {
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

// ============================================================================
// Contact Factories
// ============================================================================

/**
 * Create a mock contact object
 */
export function createMockContact(overrides: Partial<MockContact> = {}): MockContact {
  return {
    id: uuidv4(),
    name: 'Test Contact',
    type: 'user',
    phone: '+1234567890',
    ...overrides
  };
}

// ============================================================================
// Task Factories
// ============================================================================

/**
 * Create a mock task data object
 */
export function createMockTaskData(overrides: Partial<MockTaskData> = {}): MockTaskData {
  return {
    taskId: generateTaskId(),
    status: 'pending',
    result: null,
    error: null,
    ...overrides
  };
}

/**
 * Create a completed task
 */
export function createCompletedTask(result: Record<string, unknown>): MockTaskData {
  return createMockTaskData({
    status: 'done',
    result
  });
}

/**
 * Create a failed task
 */
export function createFailedTask(error: string): MockTaskData {
  return createMockTaskData({
    status: 'error',
    error
  });
}

// ============================================================================
// Agent Result Factories
// ============================================================================

/**
 * Create a mock agent result
 */
export function createMockAgentResult(overrides: Partial<MockAgentResult> = {}): MockAgentResult {
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
 * Create a successful agent result with text
 */
export function createSuccessAgentResult(text: string): MockAgentResult {
  return createMockAgentResult({ success: true, text });
}

/**
 * Create a failed agent result
 */
export function createFailedAgentResult(error: string): MockAgentResult {
  return createMockAgentResult({ success: false, text: null, error });
}

/**
 * Create an agent result with image
 */
export function createImageAgentResult(imageUrl: string, text?: string): MockAgentResult {
  return createMockAgentResult({
    success: true,
    text: text || 'Image generated',
    imageUrl,
    toolsUsed: ['generate_image']
  });
}

/**
 * Create an agent result with video
 */
export function createVideoAgentResult(videoUrl: string, text?: string): MockAgentResult {
  return createMockAgentResult({
    success: true,
    text: text || 'Video generated',
    videoUrl,
    toolsUsed: ['generate_video']
  });
}

/**
 * Create an agent result with audio
 */
export function createAudioAgentResult(audioUrl: string, text?: string): MockAgentResult {
  return createMockAgentResult({
    success: true,
    text: text || 'Audio generated',
    audioUrl,
    toolsUsed: ['text_to_speech']
  });
}

// ============================================================================
// WhatsApp Webhook Factories
// ============================================================================

/**
 * Create a mock WhatsApp webhook data
 */
export function createMockWhatsAppWebhook(overrides: Partial<MockWhatsAppWebhook> = {}): MockWhatsAppWebhook {
  const chatId = generateChatId();
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
      chatId
    },
    ...overrides
  };
}

/**
 * Create a text message webhook
 */
export function createTextWebhook(text: string): MockWhatsAppWebhook {
  return createMockWhatsAppWebhook({
    messageData: {
      typeMessage: 'textMessage',
      textMessageData: { textMessage: text }
    }
  });
}

/**
 * Create an image message webhook
 */
export function createImageWebhook(downloadUrl: string): MockWhatsAppWebhook {
  return createMockWhatsAppWebhook({
    messageData: {
      typeMessage: 'imageMessage',
      imageMessageData: { downloadUrl }
    }
  });
}

// ============================================================================
// Message Factories
// ============================================================================

/**
 * Create a mock conversation message
 */
export function createMockMessage(overrides: Partial<MockMessage> = {}): MockMessage {
  return {
    role: 'user',
    content: 'Test message',
    timestamp: Date.now(),
    metadata: {},
    ...overrides
  };
}

/**
 * Create a user message
 */
export function createUserMessage(content: string): MockMessage {
  return createMockMessage({ role: 'user', content });
}

/**
 * Create an assistant message
 */
export function createAssistantMessage(content: string): MockMessage {
  return createMockMessage({ role: 'assistant', content });
}

// ============================================================================
// Media Result Factories
// ============================================================================

/**
 * Create a mock image generation result
 */
export function createMockImageResult(overrides: Record<string, unknown> = {}) {
  return {
    imageBuffer: Buffer.from('fake-image-data'),
    text: 'Test image',
    cost: 0.01,
    provider: 'gemini',
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
    provider: 'gemini',
    duration: 5,
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
    provider: 'elevenlabs',
    duration: 3,
    ...overrides
  };
}

// ============================================================================
// Error Factories
// ============================================================================

/**
 * Create a mock API error
 */
export function createMockApiError(message: string, statusCode: number = 500) {
  return {
    message,
    response: {
      status: statusCode,
      data: { error: message }
    }
  };
}

/**
 * Create a mock database error
 */
export function createMockDbError(message: string = 'Database error') {
  const error = new Error(message);
  error.name = 'DatabaseError';
  return error;
}
