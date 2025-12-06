/**
 * Result Handling - Type Definitions
 * Shared types for result handling functionality
 */

// Export shared types
export { AgentResult } from '../../../../services/agent/types';

// Re-export NormalizedInput as AgentInput alias (for backward compatibility during refactor)
// In the future we should rename all usages to AgentInput
import { AgentInput } from '../../../../services/agent/types';
export type NormalizedInput = AgentInput;

export interface MediaSendResult {
    sent: boolean;
    textSent?: boolean;
}

