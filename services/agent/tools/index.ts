/**
 * Tools Index - Central export for all agent tools
 * Single Source of Truth for tool exports
 * 
 * This file consolidates all tool modules into one unified interface.
 * Import this file to get access to ALL agent tools.
 */

// Use ES Module imports to allow proper type inference and avoid 'require'
import * as contextTools from './contextTools';
import * as creationTools from './creation';
import * as analysisTools from './analysisTools';
import * as editingTools from './editingTools';
import * as audioTools from './audioTools';
import * as searchTools from './searchTools';
import * as driveTools from './driveTools';
import * as locationTools from './locationTools';
import * as summaryTools from './summaryTools';
import * as groupTools from './groupTools';
import * as retryTools from './retry';
import * as schedulingTools from './schedulingTools';
import * as flightTools from './flight/flightTools';
import * as shoppingTools from './shoppingTools';
import { edit_voice_style } from './remixTools'; // Importing the tool implementation
import fallbackTools from './meta/fallbackTools';
// Missing modules commented out
// import * as metaTools from './meta/metaTools'; 
// import * as utilityTools from './utilityTools';
// import * as reminderTools from './reminderTools';
// import * as storageTools from './storageTools';

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
  translate_and_speak,
  create_sound_effect
} = audioTools;

export const {
  search_web
} = searchTools;

export const {
  search_google_drive
} = driveTools;

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

export const {
  schedule_message
} = schedulingTools;

export const {
  random_flight
} = flightTools;

export const {
  smart_execute_with_fallback,
  retry_with_different_provider
} = fallbackTools;

import { AgentTool } from '../types';

/**
 * All Agent Tools - Complete collection
 * Organized by category for easy reference
 */
export const allTools: Record<string, AgentTool> = {
  // Context & Memory
  get_chat_history: contextTools.get_chat_history,
  analyze_image_from_history: contextTools.analyze_image_from_history,
  save_user_preference: contextTools.save_user_preference,
  get_long_term_memory: contextTools.get_long_term_memory,

  // Creation
  create_image: creationTools.create_image,
  create_video: creationTools.create_video,
  image_to_video: creationTools.image_to_video,
  create_music: creationTools.create_music,
  create_poll: creationTools.create_poll,

  // Shopping
  random_amazon_product: shoppingTools.random_amazon_product,
  // search_products: shoppingTools.search_products, // Missing
  // search_products_v2: shoppingTools.search_products_v2, // Missing

  // Analysis
  analyze_image: analysisTools.analyze_image,
  analyze_video: analysisTools.analyze_video,

  // Editing
  edit_image: editingTools.edit_image,
  edit_video: editingTools.edit_video,

  // Utils
  // add_group_members: groupTools.add_group_members, // Missing
  // reminder: reminderTools.reminder, // Missing
  // remove_bg: utilityTools.remove_bg, // Missing

  // Audio & Voice
  transcribe_audio: audioTools.transcribe_audio,
  text_to_speech: audioTools.text_to_speech,
  voice_clone_and_speak: audioTools.voice_clone_and_speak,
  creative_audio_mix: audioTools.creative_audio_mix,
  translate_text: audioTools.translate_text,
  translate_and_speak: audioTools.translate_and_speak,
  create_sound_effect: audioTools.create_sound_effect,
  edit_voice_style: edit_voice_style,
  // record_voice: audioTools.record_voice, // Missing

  // Search & Info
  search_web: searchTools.search_web,
  // deep_research: searchTools.deep_research, // Missing
  search_google_drive: driveTools.search_google_drive,
  chat_summary: summaryTools.chat_summary,

  // Storage
  // upload_file: storageTools.upload_file, // Missing
  // file_search: storageTools.file_search, // Missing

  // Location & Social
  send_location: locationTools.send_location,
  create_group: groupTools.create_group,

  // Meta & Retry
  retry_last_command: retryTools.retry_last_command,
  smart_execute_with_fallback: fallbackTools.smart_execute_with_fallback,
  retry_with_different_provider: fallbackTools.retry_with_different_provider,
  // self_update: metaTools.self_update, // Missing
  // agent_chat: metaTools.agent_chat, // Missing

  // Scheduling
  schedule_message: schedulingTools.schedule_message,

  // Flight
  random_flight: flightTools.random_flight
};

// Initialize retry tools with reference to all tools
retryTools.setAgentToolsReference(allTools as unknown as Record<string, { execute: (args: unknown, context: unknown) => Promise<unknown> }>);

/**
 * Get tool declarations for Gemini Function Calling
 * @returns {Array<any>} Array of tool declarations
 */
export function getToolDeclarations(): { name: string; description: string; parameters: unknown }[] {
  return Object.values(allTools)
    .filter((tool): tool is AgentTool => tool !== null && tool !== undefined && typeof tool === 'object' && 'declaration' in tool && !!tool.declaration)
    .map(tool => {
      // Create a shallow copy to avoid mutating the original
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { historyContext, ...declaration } = (tool.declaration || {}) as any;
      return declaration as { name: string; description: string; parameters: unknown };
    });
}

/**
 * Get tool by name
 * @param {string} name - Tool name
 * @returns {AgentTool | null} Tool object or null if not found
 */
export function getToolByName(name: string): AgentTool | null {
  return (allTools[name] as AgentTool) || null;
}

/**
 * Get all tool names
 * @returns {string[]} Array of tool names
 */
export function getAllToolNames(): string[] {
  return Object.keys(allTools);
}
