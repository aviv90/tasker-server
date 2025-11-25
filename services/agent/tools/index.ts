/**
 * Tools Index - Central export for all agent tools
 * Single Source of Truth for tool exports
 * 
 * This file consolidates all tool modules into one unified interface.
 * Import this file to get access to ALL agent tools.
 */

// Use ES Module imports to allow proper type inference and avoid 'require'
import * as contextTools from './contextTools';
import * as creationTools from './creationTools';
import * as analysisTools from './analysisTools';
import * as editingTools from './editingTools';
import * as audioTools from './audioTools';
import * as searchTools from './searchTools';
import * as locationTools from './locationTools';
import * as summaryTools from './summaryTools';
import * as groupTools from './groupTools';
import * as retryTools from './retryTools';

// Re-export specific functions for individual use
export const {
  get_chat_history,
  analyze_image_from_history,
  save_user_preference,
  get_long_term_memory
} = contextTools;

export const {
  create_image,
  create_video,
  image_to_video,
  create_music,
  create_poll
} = creationTools;

export const {
  analyze_image,
  analyze_video
} = analysisTools;

export const {
  edit_image,
  edit_video
} = editingTools;

export const {
  transcribe_audio,
  text_to_speech,
  voice_clone_and_speak,
  creative_audio_mix,
  translate_text,
  translate_and_speak
} = audioTools;

export const {
  search_web
} = searchTools;

export const {
  send_location
} = locationTools;

export const {
  chat_summary
} = summaryTools;

export const {
  create_group
} = groupTools;

export const {
  retry_last_command,
  setAgentToolsReference
} = retryTools;

/**
 * Tool declaration interface
 */
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Tool interface
 */
export interface Tool {
  declaration: ToolDeclaration;
  execute: (args: unknown, context: unknown) => Promise<unknown>;
}

/**
 * All Agent Tools - Complete collection
 * Organized by category for easy reference
 */
export const allTools: Record<string, Tool> = {
  // Context & Memory
  get_chat_history: contextTools.get_chat_history as unknown as Tool,
  analyze_image_from_history: contextTools.analyze_image_from_history as unknown as Tool,
  save_user_preference: contextTools.save_user_preference as unknown as Tool,
  get_long_term_memory: contextTools.get_long_term_memory as unknown as Tool,
  
  // Creation
  create_image: creationTools.create_image as unknown as Tool,
  create_video: creationTools.create_video as unknown as Tool,
  image_to_video: creationTools.image_to_video as unknown as Tool,
  create_music: creationTools.create_music as unknown as Tool,
  create_poll: creationTools.create_poll as unknown as Tool,
  
  // Analysis
  analyze_image: analysisTools.analyze_image as unknown as Tool,
  analyze_video: analysisTools.analyze_video as unknown as Tool,
  
  // Editing
  edit_image: editingTools.edit_image as unknown as Tool,
  edit_video: editingTools.edit_video as unknown as Tool,
  
  // Audio & Voice
  transcribe_audio: audioTools.transcribe_audio as unknown as Tool,
  text_to_speech: audioTools.text_to_speech as unknown as Tool,
  voice_clone_and_speak: audioTools.voice_clone_and_speak as unknown as Tool,
  creative_audio_mix: audioTools.creative_audio_mix as unknown as Tool,
  translate_text: audioTools.translate_text as unknown as Tool,
  translate_and_speak: audioTools.translate_and_speak as unknown as Tool,
  
  // Search & Info
  search_web: searchTools.search_web as unknown as Tool,
  chat_summary: summaryTools.chat_summary as unknown as Tool,
  
  // Location & Social
  send_location: locationTools.send_location as unknown as Tool,
  create_group: groupTools.create_group as unknown as Tool,
  
  // Meta & Retry
  retry_last_command: retryTools.retry_last_command as unknown as Tool
};

// Initialize retry tools with reference to all tools
retryTools.setAgentToolsReference(allTools);

/**
 * Get tool declarations for Gemini Function Calling
 * @returns {ToolDeclaration[]} Array of tool declarations
 */
export function getToolDeclarations(): ToolDeclaration[] {
  return Object.values(allTools)
    .filter((tool): tool is Tool => tool !== null && tool !== undefined && typeof tool === 'object' && 'declaration' in tool)
    .map(tool => tool.declaration);
}

/**
 * Get tool by name
 * @param {string} name - Tool name
 * @returns {Tool | null} Tool object or null if not found
 */
export function getToolByName(name: string): Tool | null {
  return (allTools[name] as Tool) || null;
}

/**
 * Get all tool names
 * @returns {string[]} Array of tool names
 */
export function getAllToolNames(): string[] {
  return Object.keys(allTools);
}
