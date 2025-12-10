/**
 * Central Tools Registry - Single Source of Truth
 * ALL tool definitions and descriptions live here (aggregated from config/tools/*)
 * Used by: prompts.ts, agentService.ts system instructions
 */

import { Tool, ToolParameter } from './tools/types';
import { locationTools } from './tools/location';
import { creationTools } from './tools/creation';
import { analysisTools } from './tools/analysis';
import { editingTools } from './tools/editing';
import { audioTools } from './tools/audio';
import { searchTools } from './tools/search';
import { contextTools } from './tools/context';
import { metaTools } from './tools/meta';

const TOOLS: Record<string, Tool> = {
  ...locationTools,
  ...creationTools,
  ...analysisTools,
  ...editingTools,
  ...audioTools,
  ...searchTools,
  ...contextTools,
  ...metaTools,
  edit_voice_style: {
    name: 'edit_voice_style',
    description: 'Edit the style, emotion, or tone of a quoted voice note. Use this for "Edit", "Change", "Modify" requests on voice/audio styling.',
    parameters: {
      style_description: {
        type: 'string',
        required: true,
        description: 'Description of the desired voice style/emotion (e.g. "excited", "whispering")'
      }
    },
    usage: [
      'Quote a voice note and say: "Edit this to sound happy"',
      'Quote a voice note and say: "Change to a whispering ghost voice"'
    ],
    category: 'editing'
  }
};

/**
 * Get tools by category
 */
export function getToolsByCategory(category: string): Tool[] {
  return Object.values(TOOLS).filter(tool => tool.category === category);
}

/**
 * Get user-facing tools (exclude meta-tools)
 */
export function getUserFacingTools(): Tool[] {
  return Object.values(TOOLS).filter(tool => tool.category !== 'meta');
}

/**
 * Get tools for multi-step planner (most relevant)
 */
export function getPlannerTools(): Tool[] {
  const categories = ['location', 'creation', 'audio', 'search', 'context', 'analysis', 'editing'];
  return Object.values(TOOLS).filter(tool => categories.includes(tool.category));
}

/**
 * Format tools list for prompts
 */
export function formatToolsForPrompt(tools: Tool[] = getUserFacingTools()): string {
  return tools.map(tool => {
    const params = Object.keys(tool.parameters || {})
      .map(key => {
        const param = tool.parameters[key];
        if (!param) return '';
        return `${key}${param.required ? '' : '?'}:${param.type}`;
      })
      .filter(Boolean)
      .join(', ');

    return `• ${tool.name}(${params}) - ${tool.description}`;
  }).join('\n');
}

/**
 * Format compact tools list (name + description only)
 */
export function formatToolsCompact(tools: Tool[] = getUserFacingTools()): string {
  return tools.map(tool => `• ${tool.name} - ${tool.description}`).join('\n');
}

/**
 * Get critical rules for specific tools
 */
export function getCriticalRules(): string {
  return Object.values(TOOLS)
    .filter(tool => tool.critical)
    .map(tool => `• ${tool.name}: ${tool.critical}`)
    .join('\n');
}

/**
 * Get history context rules for all tools
 */
export function getHistoryContextRules(): string {
  const rules: string[] = [];

  Object.values(TOOLS).forEach(tool => {
    if (tool.historyContext) {
      const action = tool.historyContext.ignore ? 'IGNORE' : 'USE';
      rules.push(`• ${tool.name}: ${action} history - ${tool.historyContext.reason}`);
    }
  });

  return rules.join('\n');
}

export { TOOLS };
export type { Tool, ToolParameter };
