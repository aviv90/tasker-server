import * as taskStore from '../../store/taskStore';
import { extractErrorMessage } from '../../utils/errorHandler';
import fs from 'fs';
import path from 'path';
import { Request } from 'express';

/**
 * Finalize helper functions for upload routes
 */
class Finalizers {
  /**
   * Finalize image edit task
   */
  async finalize(taskId: string, result: any, req: Request) {
    try {
      if (!result || result.error) {
        const errorMessage = extractErrorMessage(result?.error || result || 'Image edit failed');
        await taskStore.set(taskId, {
          status: 'error',
          error: errorMessage
        });
        return;
      }

      const filename = `${taskId}.png`;
      const outputDir = path.join(__dirname, '../..', 'public', 'tmp');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, filename), result.imageBuffer);

      const host = `${req.protocol}://${req.get('host')}`;
      await taskStore.set(taskId, {
        status: 'done',
        result: `${host}/static/${filename}`,
        text: result.text
      });
    } catch (error: unknown) {
      console.error(`❌ Error in finalize:`, error);
      const errorMessage = extractErrorMessage(error);
      await taskStore.set(taskId, {
        status: 'error',
        error: errorMessage
      });
    }
  }

  /**
   * Finalize transcription task
   */
  async finalizeTranscription(taskId: string, result: any) {
    try {
      // Check if there's an error
      if (!result || result.error) {
        const errorResult: any = {
          status: 'error',
          error: result.error || 'Transcription failed'
        };

        // If we have transcribed text despite the error, include it
        if (result?.text) {
          errorResult.text = result.text;
        }

        await taskStore.set(taskId, errorResult);
        console.log(`❌ Transcription failed: ${result?.error || 'Unknown error'}`);
        return;
      }

      // Success case
      const taskResult: any = {
        status: 'done',
        result: result.text,
        text: result.text,
        language: result.metadata?.language || 'unknown',
        timestamp: new Date().toISOString()
      };

      // Add metadata if available
      if (result.metadata) {
        taskResult.metadata = result.metadata;
      }

      await taskStore.set(taskId, taskResult);
      console.log(`✅ Transcription completed. Text length: ${result.text?.length || 0} characters`);
    } catch (error: unknown) {
      console.error(`❌ Error in finalizeTranscription:`, error);
      const errorMessage = extractErrorMessage(error);
      await taskStore.set(taskId, {
        status: 'error',
        error: errorMessage
      });
    }
  }

  /**
   * Finalize voice processing task
   */
  async finalizeVoiceProcessing(taskId: string, result: any, req: Request | null = null) {
    try {
      // Check if there's an error
      if (result.error) {
        const errorResult: any = {
          status: 'error',
          error: result.error
        };

        // If we have transcribed text, include it
        if (result.text) {
          errorResult.text = result.text;
        }

        await taskStore.set(taskId, errorResult);
        console.log(`❌ Voice processing failed: ${result.error}`);
        return;
      }

      // Success case - create full URL for audio file
      let audioURL = result.result || result.audioUrl;
      if (req && audioURL && audioURL.startsWith('/static/')) {
        const host = `${req.protocol}://${req.get('host')}`;
        audioURL = `${host}${audioURL}`;
      }

      const taskResult: taskStore.TaskData = {
        status: 'done',
        text: result.text,
        result: audioURL
      };

      console.log(`📝 Saving final result with text: "${result.text?.substring(0, 100) || 'MISSING TEXT'}..."`);
      await taskStore.set(taskId, taskResult);
      console.log(`✅ Voice processing completed: ${result.text?.length || 0} chars → ${audioURL}`);
    } catch (error: unknown) {
      console.error(`❌ Error in finalizeVoiceProcessing:`, error);
      const errorMessage = extractErrorMessage(error);
      await taskStore.set(taskId, {
        status: 'error',
        error: errorMessage
      });
    }
  }
}

export default new Finalizers();
