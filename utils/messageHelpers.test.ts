/**
 * Message Helpers Tests
 * Unit tests for message helper utilities
 */

import {
  extractQuotedMessageId,
  shouldSkipAgentResult
} from './messageHelpers';

describe('messageHelpers', () => {
  describe('extractQuotedMessageId', () => {
    it('should return null for empty options', () => {
      expect(extractQuotedMessageId({})).toBeNull();
    });

    it('should return quotedMessageId if present', () => {
      expect(extractQuotedMessageId({ quotedMessageId: 'msg123' })).toBe('msg123');
    });

    it('should return originalMessageId if present', () => {
      expect(extractQuotedMessageId({ originalMessageId: 'msg456' })).toBe('msg456');
    });

    it('should prioritize quotedMessageId over originalMessageId', () => {
      expect(extractQuotedMessageId({
        quotedMessageId: 'msg123',
        originalMessageId: 'msg456'
      })).toBe('msg123');
    });

    it('should extract from context.originalInput', () => {
      expect(extractQuotedMessageId({
        context: {
          originalInput: {
            originalMessageId: 'msg789'
          }
        }
      })).toBe('msg789');
    });

    it('should extract from agentResult', () => {
      expect(extractQuotedMessageId({
        agentResult: {
          originalMessageId: 'msg101'
        }
      })).toBe('msg101');
    });

    it('should extract from normalized', () => {
      expect(extractQuotedMessageId({
        normalized: {
          originalMessageId: 'msg202'
        }
      })).toBe('msg202');
    });

    it('should extract from command', () => {
      expect(extractQuotedMessageId({
        command: {
          originalMessageId: 'msg303'
        }
      })).toBe('msg303');
    });

    it('should extract from webhookData', () => {
      expect(extractQuotedMessageId({
        webhookData: {
          idMessage: 'msg404'
        }
      })).toBe('msg404');
    });

    it('should extract from context.originalMessageId', () => {
      expect(extractQuotedMessageId({
        context: {
          originalMessageId: 'msg505'
        }
      })).toBe('msg505');
    });
  });

  describe('shouldSkipAgentResult', () => {
    it('should return false for non-multi-step results', () => {
      expect(shouldSkipAgentResult({})).toBe(false);
      expect(shouldSkipAgentResult({ multiStep: false })).toBe(false);
    });

    it('should return false for multi-step without alreadySent', () => {
      expect(shouldSkipAgentResult({ multiStep: true })).toBe(false);
    });

    it('should return true for multi-step with alreadySent', () => {
      expect(shouldSkipAgentResult({
        multiStep: true,
        alreadySent: true
      })).toBe(true);
    });

    it('should return false for alreadySent without multiStep', () => {
      expect(shouldSkipAgentResult({ alreadySent: true })).toBe(false);
    });
  });
});

