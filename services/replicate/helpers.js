/**
 * Replicate helper functions
 */
class ReplicateHelpers {
  /**
   * Calculate cost for prediction
   */
  calculateCost(prediction, isVeo3 = false) {
    try {
      if (isVeo3) {
        // Veo 3 costs $6 per 8-second video ($0.75 per second)
        return "6.00";
      } else {
        // Kling v2.1 Master costs $0.28 per second (5s = $1.40)
        return "1.40"; // Fixed cost for 5-second Kling video
      }
    } catch (err) {
      return isVeo3 ? "6.00" : "1.40";
    }
  }

  /**
   * Extract error details from Replicate error
   */
  extractErrorDetails(error) {
    let errorMessage = error.message || error.toString();

    if (error.response?.data) {
      const errorDetails = {
        message: error.response.data.detail || error.message,
        status: error.response.status,
        statusText: error.response.statusText,
        type: error.response.data.type,
        title: error.response.data.title
      };

      const cleanDetails = Object.entries(errorDetails)
        .filter(([key, value]) => value !== undefined)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ');

      errorMessage = cleanDetails || errorMessage;
    }

    return errorMessage;
  }

  /**
   * Poll prediction until completion
   */
  async pollPrediction(replicate, predictionId, maxAttempts, operationType = 'video generation') {
    let attempts = 0;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 10000));
      attempts++;

      console.log(`🔄 Polling attempt ${attempts}/${maxAttempts} for ${operationType}`);

      try {
        const result = await replicate.predictions.get(predictionId);

        if (result.status === 'succeeded' && result.output) {
          return { success: true, result };
        }

        if (result.status === 'failed' || result.status === 'canceled') {
          const errorMsg = result.error || `Task ${result.status}`;
          return { success: false, error: errorMsg };
        }

      } catch (pollError) {
        console.log(`❌ Polling attempt ${attempts} failed:`, pollError.message);
        if (pollError.response?.status === 401 || pollError.response?.status === 402 || pollError.response?.status === 429) {
          return { success: false, error: this.extractErrorDetails(pollError) };
        }
      }
    }

    return { success: false, error: `${operationType} timed out after ${maxAttempts} attempts` };
  }

  /**
   * Extract video URL from Replicate output
   */
  extractVideoUrl(output) {
    if (Array.isArray(output)) {
      return output[0];
    } else if (typeof output === 'object' && output.video) {
      return output.video;
    } else if (typeof output === 'object' && output.output) {
      return output.output;
    }
    return output;
  }
}

module.exports = new ReplicateHelpers();

