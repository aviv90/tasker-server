/**
 * Replicate helper functions
 */

import Replicate from 'replicate';

/**
 * Replicate prediction result
 */
interface PredictionResult {
  status: string;
  output?: unknown;
  error?: string;
}

/**
 * Poll result
 */
interface PollResult {
  success: boolean;
  result?: PredictionResult;
  error?: string;
}

/**
 * Replicate helper functions
 */
class ReplicateHelpers {
  /**
   * Calculate cost for prediction
   */
  calculateCost(_prediction: unknown, isVeo3 = false): string {
    try {
      if (isVeo3) {
        // Veo 3 costs $6 per 8-second video ($0.75 per second)
        return "6.00";
      } else {
        // Kling v2.1 Master costs $0.28 per second (5s = $1.40)
        return "1.40"; // Fixed cost for 5-second Kling video
      }
    } catch (_err) {
      return isVeo3 ? "6.00" : "1.40";
    }
  }

  /**
   * Extract error details from Replicate error
   */
  extractErrorDetails(error: unknown): string {
    let errorMessage = 'Unknown error';
    
    if (error instanceof Error) {
      errorMessage = error.message || error.toString();
    } else if (typeof error === 'string') {
      errorMessage = error;
    }

    interface ErrorResponse {
      response?: {
        data?: {
          detail?: string;
          type?: string;
          title?: string;
        };
        status?: number;
        statusText?: string;
      };
    }

    const errorWithResponse = error as ErrorResponse;
    if (errorWithResponse.response?.data) {
      const errorDetails: Record<string, string | number | undefined> = {
        message: errorWithResponse.response.data.detail || errorMessage,
        status: errorWithResponse.response.status,
        statusText: errorWithResponse.response.statusText,
        type: errorWithResponse.response.data.type,
        title: errorWithResponse.response.data.title
      };

      const cleanDetails = Object.entries(errorDetails)
        .filter(([_key, value]) => value !== undefined)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ');

      errorMessage = cleanDetails || errorMessage;
    }

    return errorMessage;
  }

  /**
   * Poll prediction until completion
   */
  async pollPrediction(
    replicate: Replicate,
    predictionId: string,
    maxAttempts: number,
    operationType = 'video generation'
  ): Promise<PollResult> {
    let attempts = 0;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 10000));
      attempts++;

      console.log(`🔄 Polling attempt ${attempts}/${maxAttempts} for ${operationType}`);

      try {
        const result = await replicate.predictions.get(predictionId) as PredictionResult;

        if (result.status === 'succeeded' && result.output) {
          return { success: true, result };
        }

        if (result.status === 'failed' || result.status === 'canceled') {
          const errorMsg = result.error || `Task ${result.status}`;
          return { success: false, error: errorMsg };
        }

      } catch (pollError: unknown) {
        const errorMessage = pollError instanceof Error ? pollError.message : String(pollError);
        console.log(`❌ Polling attempt ${attempts} failed:`, errorMessage);
        
        interface PollErrorResponse {
          response?: {
            status?: number;
          };
        }
        
        const pollErrorWithResponse = pollError as PollErrorResponse;
        if (pollErrorWithResponse.response?.status === 401 || 
            pollErrorWithResponse.response?.status === 402 || 
            pollErrorWithResponse.response?.status === 429) {
          return { success: false, error: this.extractErrorDetails(pollError) };
        }
      }
    }

    return { success: false, error: `${operationType} timed out after ${maxAttempts} attempts` };
  }

  /**
   * Extract video URL from Replicate output
   */
  extractVideoUrl(output: unknown): string {
    if (Array.isArray(output)) {
      return String(output[0]);
    } else if (output && typeof output === 'object') {
      const outputObj = output as Record<string, unknown>;
      if (outputObj.video) {
        return String(outputObj.video);
      } else if (outputObj.output) {
        return String(outputObj.output);
      }
    }
    return String(output);
  }
}

export default new ReplicateHelpers();

