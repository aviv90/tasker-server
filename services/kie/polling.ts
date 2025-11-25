/**
 * Kie Service Polling Logic
 */

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
  console.log('⏳ Polling for video generation completion...');
  const startTime = Date.now();
  let pollAttempts = 0;

  while (Date.now() - startTime < maxWaitTime) {
    pollAttempts++;
    console.log(`🔄 Polling attempt ${pollAttempts} for Kie.ai ${model} task ${taskId}`);

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
      console.error(`❌ Kie.ai ${model} status check failed:`, statusData.msg);
      return { error: statusData.msg || 'Status check failed' };
    }

    const status = statusData.data;
    if (!status) {
      return { error: 'No status data in response' };
    }

    console.log(`📊 Kie.ai ${model} status check - successFlag: ${status.successFlag}`);
    console.log(`📊 Status: ${status.status} (${status.progress}%)`);

    if (status.successFlag === 1) {
      // Success - video is ready
      return { success: true, status: status as PollResult['status'] };
    } else if (status.successFlag === 2 || status.successFlag === 3) {
      // Failed
      console.error(`❌ Kie.ai ${model} video generation failed`);
      return { error: 'Video generation failed', status: status as PollResult['status'] };
    }

    // Still processing (successFlag === 0), wait and retry
    await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds
  }

  // Timeout
  console.error(`❌ Kie.ai ${model} video generation timed out after 15 minutes`);
  return { error: 'Video generation timed out after 15 minutes' };
}

/**
 * Extract video URLs from status response
 */
export function extractVideoUrls(responseData: { resultUrls?: string[] | string }, model: string): ExtractVideoUrlsResult {
  if (!responseData || !responseData.resultUrls) {
    console.error(`❌ Kie.ai ${model} video generation completed but no URLs in response`);
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
      console.error(`❌ Kie.ai ${model} failed to parse result URLs:`, parseError);
      return { error: `Failed to parse result URLs: ${errorMessage}` };
    }
  } else {
    console.error(`❌ Kie.ai ${model} resultUrls is not array or string:`, typeof responseData.resultUrls);
    return { error: 'Invalid resultUrls format' };
  }

  if (!videoUrls || !Array.isArray(videoUrls) || videoUrls.length === 0) {
    console.error(`❌ Kie.ai ${model} no valid video URLs found`);
    return { error: 'No valid video URLs found' };
  }

  return { videoUrls };
}

