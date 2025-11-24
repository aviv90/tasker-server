import * as taskStore from '../../store/taskStore';
import * as musicService from '../../services/musicService';
import { Request, Response, Router } from 'express';

// Map between our task IDs and Kie.ai task IDs for callback handling
const kieTaskMapping = new Map<string, string>();

/**
 * Callback route handlers
 */
class CallbackRoutes {
  /**
   * Setup callback routes
   */
  setupRoutes(router: Router, rateLimiter: any = null) {
    const handlers: any[] = [];
    if (rateLimiter) handlers.push(rateLimiter);

    /**
     * Callback route for Kie.ai music generation notifications
     */
    router.post('/music/callback', ...handlers, async (req: Request, res: Response) => {
      try {
        console.log('🎵 Music callback received');

        const callbackData = req.body;

        // Handle Suno music generation callbacks
        if (callbackData.data && callbackData.data.task_id) {
          const kieTaskId = callbackData.data.task_id;

          // Process callback in background without blocking response
          musicService.handleCallbackCompletion(kieTaskId, callbackData).then(async (result: any) => {
            if (result && !result.error) {
              console.log(`✅ Suno music callback processed successfully for task ${kieTaskId}`);

              // Find our task ID based on the Kie.ai task ID
              const ourTaskId = kieTaskMapping.get(kieTaskId);

              if (ourTaskId) {
                // Update our task store with the processed result
                await taskStore.set(ourTaskId, {
                  status: 'done',
                  result: result.result,
                  audioBuffer: result.audioBuffer,
                  metadata: result.metadata,
                  type: 'music-generation',
                  timestamp: new Date().toISOString()
                });

                console.log(`✅ Task ${ourTaskId} completed successfully`);

                // Clean up the mapping
                kieTaskMapping.delete(kieTaskId);
              }
            } else {
              console.log(`⚠️ Music callback processing failed: ${result?.error || 'Unknown error'}`);
            }
          }).catch((error: any) => {
            console.error(`❌ Error processing music callback:`, error);
          });
        }

        // Acknowledge the callback
        res.status(200).json({
          status: 'received',
          message: 'Callback processed successfully'
        });

      } catch (error) {
        console.error('❌ Error processing music callback:', error);
        res.status(500).json({ error: 'Callback processing failed' });
      }
    });

    /**
     * Callback route for Kie.ai music VIDEO generation notifications
     */
    router.post('/video/callback', ...handlers, async (req: Request, res: Response) => {
      try {
        console.log('🎬 Music video callback received');

        const callbackData = req.body;

        // Handle Suno music video generation callbacks
        if (callbackData.data && callbackData.data.task_id) {
          const videoTaskId = callbackData.data.task_id;

          console.log(`🎬 Processing video callback for task: ${videoTaskId}`);

          // Process callback in background without blocking response
          musicService.handleVideoCallbackCompletion(videoTaskId, callbackData).then((result: any) => {
            if (result && !result.error) {
              console.log(`✅ Music video callback processed successfully for task ${videoTaskId}`);
            } else {
              console.error(`❌ Music video callback processing failed for task ${videoTaskId}:`, result?.error);
            }
          }).catch((error: any) => {
            console.error(`❌ Error processing music video callback:`, error);
          });
        }

        // Acknowledge the callback
        res.status(200).json({
          status: 'received',
          message: 'Video callback processed successfully'
        });

      } catch (error) {
        console.error('❌ Error processing music video callback:', error);
        res.status(500).json({ error: 'Video callback processing failed' });
      }
    });
  }

  /**
   * Get kieTaskMapping for external access
   */
  getKieTaskMapping() {
    return kieTaskMapping;
  }
}

export default new CallbackRoutes();
