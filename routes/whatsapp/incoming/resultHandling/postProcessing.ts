/**
 * Result Handling - Post Processing
 * Handles post-processing operations like complementary image generation
 */

import logger from '../../../../utils/logger';
import { AgentResult, NormalizedInput } from './types';

/**
 * Handle post-processing: generate complementary image if text+image requested
 * @param chatId - Chat ID
 * @param normalized - Normalized input
 * @param agentResult - Agent result
 * @param quotedMessageId - Optional: ID of message to quote
 */
export async function handlePostProcessing(
  chatId: string,
  normalized: NormalizedInput,
  agentResult: AgentResult,
  quotedMessageId: string | null = null
): Promise<void> {
  try {
    // Prevent unused variable warnings
    void chatId;
    void normalized;
    void quotedMessageId;

    // CRITICAL: Skip post-processing if a media asset was already created
    // Video, audio, and poll are complete outputs - don't trigger secondary image generation
    if (agentResult.videoUrl || agentResult.audioUrl || agentResult.poll) {
      return;
    }

    // Also skip if the tool used was a video/audio creation tool (even if URL not in result yet)
    const videoAudioTools = ['image_to_video', 'create_video', 'create_music', 'text_to_speech', 'creative_audio_mix'];
    const toolsUsed = agentResult.toolsUsed || [];
    if (toolsUsed.some(tool => videoAudioTools.includes(tool))) {
      return;
    }

    // LOGIC REMOVED: Previous heuristic for "text+image" requests caused hallucinations
    // (e.g. generating an image when the user asked to ANALYZE an image).
    // We now rely 100% on the Agent to decide if an image should be generated.
    // If the Agent didn't generate an image, we respect that decision.

    // Check for other post-processing needs here in the future if necessary.
    logger.debug('✨ [Agent Post] Post-processing skipped (heuristics disabled to prevent hallucinations)');
  } catch (postError: unknown) {
    const errorMessage = postError instanceof Error ? postError.message : String(postError);
    const errorStack = postError instanceof Error ? postError.stack : undefined;
    logger.error('❌ [Agent Post] Error while handling text+image multi-step fallback:', { error: errorMessage, stack: errorStack });
  }
}

