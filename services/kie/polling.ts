/**
 * Kie Service Polling Logic
 */

import logger from '../../utils/logger';
import { TIME } from '../../utils/constants';

/**
 * Poll result
 */
interface PollResult {
  success?: boolean;
  status?: {
    response?: {
      resultUrls?: string[] | string;
    };
    [key: string]: unknown;
  };
  error?: string;
}

/**
 * Extract video URLs result
 */
interface ExtractVideoUrlsResult {
  videoUrls?: string[];
  error?: string;
}

/**
 * Poll for video generation completion
 */
export async function pollVideoGeneration(
  apiKey: string | undefined,
  baseUrl: string,
  taskId: string,
  model: string,
  maxWaitTime = 15 * 60 * 1000
): Promise<PollResult> {
  logger.info('⏳ Polling for video generation completion...');
  const startTime = Date.now();
  let pollAttempts = 0;

  while (Date.now() - startTime < maxWaitTime) {
    pollAttempts++;
    logger.debug(`🔄 Polling attempt ${pollAttempts} for Kie.ai ${model} task ${taskId}`);

    const statusResponse = await fetch(`${baseUrl}/api/v1/veo/record-info?taskId=${taskId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey || ''}` }
    });

    const statusData = await statusResponse.json() as {
      code?: number;
      msg?: string;
      data?: {
        successFlag?: number;
        status?: string;
        progress?: number;
        [key: string]: unknown;
      };
    };

    if (!statusResponse.ok || statusData.code !== 200) {
      logger.error(`❌ Kie.ai ${model} status check failed:`, { error: statusData.msg });
      return { error: statusData.msg || 'Status check failed' };
    }

    const status = statusData.data;
    if (!status) {
      return { error: 'No status data in response' };
    }

    logger.debug(`📊 Kie.ai ${model} status check - successFlag: ${status.successFlag}, Status: ${status.status} (${status.progress}%)`);

    if (status.successFlag === 1) {
      // Success - video is ready
      return { success: true, status: status as PollResult['status'] };
    } else if (status.successFlag === 2 || status.successFlag === 3) {
      // Failed
      logger.error(`❌ Kie.ai ${model} video generation failed`);
      return { error: 'Video generation failed', status: status as PollResult['status'] };
    }

    // Still processing (successFlag === 0), wait and retry
    await new Promise(resolve => setTimeout(resolve, TIME.POLL_INTERVAL_SLOW));
  }

  // Timeout
  logger.error(`❌ Kie.ai ${model} video generation timed out after 15 minutes`);
  return { error: 'Video generation timed out after 15 minutes' };
}

/**
 * Extract video URLs from status response
 */
export function extractVideoUrls(responseData: { resultUrls?: string[] | string }, model: string): ExtractVideoUrlsResult {
  if (!responseData || !responseData.resultUrls) {
    logger.error(`❌ Kie.ai ${model} video generation completed but no URLs in response`);
    return { error: 'Video generation completed but no URLs in response' };
  }

  let videoUrls: string[];
  // resultUrls should already be an array according to the docs
  if (Array.isArray(responseData.resultUrls)) {
    videoUrls = responseData.resultUrls;
  } else if (typeof responseData.resultUrls === 'string') {
    // Fallback: try to parse as JSON if it's a string
    try {
      videoUrls = JSON.parse(responseData.resultUrls) as string[];
    } catch (parseError: unknown) {
      const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
      logger.error(`❌ Kie.ai ${model} failed to parse result URLs:`, { error: errorMessage, stack: parseError instanceof Error ? parseError.stack : undefined });
      return { error: `Failed to parse result URLs: ${errorMessage}` };
    }
  } else {
    logger.error(`❌ Kie.ai ${model} resultUrls is not array or string:`, { type: typeof responseData.resultUrls });
    return { error: 'Invalid resultUrls format' };
  }

  if (!videoUrls || !Array.isArray(videoUrls) || videoUrls.length === 0) {
    logger.error(`❌ Kie.ai ${model} no valid video URLs found`);
    return { error: 'No valid video URLs found' };
  }

  return { videoUrls };
}

