/**
 * Result Handling - Audio Media
 * Handles sending audio results to WhatsApp
 */

import * as greenApiService from '../../../../services/greenApiService';
import { normalizeStaticFileUrl } from '../../../../utils/urlUtils';
import { shouldSkipAgentResult } from '../../../../utils/messageHelpers';
import logger from '../../../../utils/logger';
import { AgentResult } from '../types';

/**
 * Send audio result
 * @param chatId - Chat ID
 * @param agentResult - Agent result
 * @param quotedMessageId - Optional: ID of message to quote
 * @returns True if sent
 */
export async function sendAudioResult(
  chatId: string, 
  agentResult: AgentResult, 
  quotedMessageId: string | null = null
): Promise<boolean> {
  if (!agentResult.audioUrl) return false;

  // For multi-step, audio is already sent in agentService - skip here
  if (shouldSkipAgentResult(agentResult)) {
    logger.debug(`⏭️ [Agent] Skipping audio send - already sent in multi-step`);
    return false;
  }

  logger.debug(`🎵 [Agent] Sending generated audio: ${agentResult.audioUrl}`);
  // Audio doesn't support captions - send as file only
  const fullAudioUrl = normalizeStaticFileUrl(agentResult.audioUrl);
  await greenApiService.sendFileByUrl(chatId, fullAudioUrl, `agent_audio_${Date.now()}.mp3`, '', quotedMessageId || undefined, 1000);

  // For audio files (TTS/translate_and_speak), don't send text - the audio IS the response
  return true;
}

