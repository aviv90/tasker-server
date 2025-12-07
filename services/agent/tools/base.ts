/**
 * Base Tool Helpers
 * Utilities for creating strongly-typed agent tools.
 */

import { AgentTool, ToolResult } from '../types';
import { AgentContextState } from '../execution/context';

/**
 * Helper to create a strongly-typed tool.
 * Usage:
 * export const myTool = createTool<MyArgs>(
 *   { ...declaration... },
 *   async (args, context) => { ... }
 * );
 */
export const createTool = <TArgs>(
    declaration: AgentTool['declaration'],
    impl: (args: TArgs, context: AgentContextState) => Promise<ToolResult>
): AgentTool<TArgs> => {
    return {
        declaration,
        execute: impl
    };
};
