import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import * as taskStore from '../../store/taskStore';
import * as geminiService from '../../services/geminiService';
import * as speechService from '../../services/speechService';
import { voiceService } from '../../services/voiceService';
import { extractErrorMessage } from '../../utils/errorHandler';
import path from 'path';
import finalizers from './finalizers';
import { Request, Response, Router } from 'express';
import logger from '../../utils/logger';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    fieldSize: 50 * 1024 * 1024
  }
});

interface TranscriptionUploadRequest extends Request {
    file?: Express.Multer.File;
    body: {
        model?: string;
        language?: string;
        removeNoise?: string;
        removeFiller?: string;
        optimizeLatency?: string;
        voiceName?: string;
        voiceDescription?: string;
        removeBackgroundNoise?: string;
        geminiModel?: string;
        ttsModel?: string;
        outputFormat?: string;
        optimizeStreamingLatency?: string;
        [key: string]: any;
    };
}

/**
 * Transcription upload routes
 */
class TranscriptionUploadRoutes {
  /**
   * Setup transcription upload routes
   */
  setupRoutes(router: Router, rateLimiter: any = null) {
    const handlers: any[] = [upload.single('file')];
    if (rateLimiter) handlers.push(rateLimiter);

    /**
     * Upload audio and transcribe with voice processing pipeline
     */
    router.post('/upload-transcribe', ...handlers, async (req: TranscriptionUploadRequest, res: Response) => {
      if (!req.file) {
        res.status(400).json({ status: 'error', error: 'Missing audio file' });
        return;
      }

      // Validate file size for ElevenLabs (25MB limit)
      if (req.file.size > 25 * 1024 * 1024) {
        res.status(413).json({
          status: 'error',
          error: `File too large: ${Math.round(req.file.size / 1024 / 1024)}MB. Maximum size is 25MB.`
        });
        return;
      }

      const taskId = uuidv4();
      await taskStore.set(taskId, { status: 'pending' });
      res.json({ taskId });

      try {
        logger.info('🎤 Starting enhanced voice processing pipeline with Gemini integration...');
        logger.info('📋 Pipeline: Transcription → Voice Clone → Gemini Response → Text-to-Speech → Cleanup');

        // Step 1: Speech-to-Text transcription
        const originalExtension = path.extname(req.file.originalname).slice(1).toLowerCase();
        const supportedFormats = ['mp3', 'wav', 'ogg', 'opus', 'webm', 'm4a', 'aac', 'flac'];
        const format = supportedFormats.includes(originalExtension) ? originalExtension : 'wav';

        const transcriptionOptions = {
          model: req.body.model || 'scribe_v1',
          language: req.body.language === 'auto' ? null : req.body.language || null,
          removeNoise: req.body.removeNoise !== 'false',
          removeFiller: req.body.removeFiller !== 'false',
          optimizeLatency: parseInt(req.body.optimizeLatency || '0') || 0,
          format: format
        };

        logger.info('🔄 Step 1: Transcribing speech...');
        const transcriptionResult: any = await speechService.speechToText(req.file.buffer, transcriptionOptions);

        if (transcriptionResult.error) {
          logger.error('❌ Transcription failed:', transcriptionResult.error);
          await finalizers.finalizeTranscription(taskId, transcriptionResult);
          return;
        }

        const transcribedText = transcriptionResult.text;
        logger.info(`✅ Step 1 complete: Transcribed ${transcribedText.length} characters`);

        // Step 2: Create Instant Voice Clone with optimal parameters
        logger.info('🔄 Step 2: Creating voice clone with optimized parameters...');
        const voiceName = req.body.voiceName || `Voice_${Date.now()}`;

        // Use our own language detection on transcribed text for consistency
        const originalLanguage = voiceService.detectLanguage(transcribedText);
        const sttDetected = transcriptionResult.metadata?.language || 'auto';
        logger.info('🌐 Language detection for voice clone:');
        logger.info(`   - STT detected: ${sttDetected}`);
        logger.info(`   - Our detection: ${originalLanguage}`);

        const voiceCloneOptions = {
          name: voiceName,
          description: req.body.voiceDescription || `High-quality voice clone (${originalLanguage})`,
          removeBackgroundNoise: req.body.removeBackgroundNoise !== 'false',
          labels: JSON.stringify({
            accent: originalLanguage === 'he' ? 'hebrew' : 'natural',
            use_case: 'conversational',
            quality: 'high',
            style: 'natural',
            language: originalLanguage
          })
        };

        const voiceCloneResult: any = await voiceService.createInstantVoiceClone([req.file.buffer], voiceCloneOptions);

        if (voiceCloneResult.error) {
          logger.error('❌ Voice cloning failed:', voiceCloneResult.error);
          // If voice cloning fails, return error with transcription
          await finalizers.finalizeVoiceProcessing(taskId, {
            text: transcribedText,
            error: voiceCloneResult.error
          }, req);
          return;
        }

        const voiceId = voiceCloneResult.voiceId;
        logger.info(`✅ Step 2 complete: Voice clone created with ID ${voiceId}`);

        // Step 3: Generate Gemini response (Chatbot)
        logger.info('🔄 Step 3: Generating Gemini response to transcribed text...');
        // generateTextResponse expects conversationHistory array, but we pass options as second param
        // Using type assertion to match JS behavior
        const geminiResult = await (geminiService as any).generateTextResponse(transcribedText, []);

        let textForTTS = transcribedText; // Default to original text

        if (geminiResult.error) {
          logger.warn('⚠️ Gemini generation failed:', geminiResult.error);
          logger.info('📝 Using original transcribed text for TTS');
        } else {
          textForTTS = geminiResult.text;
          logger.info('✅ Step 3 complete: Gemini response generated');
        }

        // Step 4: Text-to-Speech with cloned voice
        logger.info('🔄 Step 4: Converting text to speech with cloned voice...');

        // For TTS, use the original language to maintain consistency throughout the flow
        const ttsLanguage = originalLanguage;
        logger.info('🌐 Language consistency in upload-transcribe:');
        logger.info(`   - Original (from transcription): ${originalLanguage}`);
        logger.info(`   - TTS (forced same): ${ttsLanguage}`);

        const ttsOptions: any = {
          modelId: req.body.ttsModel || 'eleven_v3',
          outputFormat: req.body.outputFormat || 'mp3_44100_128',
          languageCode: ttsLanguage
        };

        // Only add optimizeStreamingLatency if explicitly requested and not using eleven_v3
        if (req.body.optimizeStreamingLatency && (req.body.ttsModel && req.body.ttsModel !== 'eleven_v3')) {
          ttsOptions.optimizeStreamingLatency = parseInt(req.body.optimizeStreamingLatency);
          logger.info(`⚡ Added streaming latency optimization: ${ttsOptions.optimizeStreamingLatency}`);
        }

        const ttsResult = await voiceService.textToSpeech(voiceId, textForTTS, ttsOptions) as { error?: string; audioUrl?: string; metadata?: unknown };

        if (ttsResult.error) {
          logger.error('❌ Text-to-speech failed:', ttsResult.error);
          // If TTS fails, return error with transcription
          await finalizers.finalizeVoiceProcessing(taskId, {
            text: transcribedText,
            error: ttsResult.error
          }, req);
          return;
        }

        logger.info(`✅ Step 4 complete: Audio generated at ${ttsResult.audioUrl}`);

        // Final result: Complete pipeline success
        logger.info(`📝 Finalizing with transcribed text: "${transcribedText.substring(0, 100)}..."`);
        await finalizers.finalizeVoiceProcessing(taskId, {
          text: transcribedText, // The original transcribed text - this is what should be returned
          result: ttsResult.audioUrl,
          geminiResponse: geminiResult.error ? null : geminiResult.text,
          voiceId: voiceId,
          transcriptionMetadata: (transcriptionResult as any).metadata,
          voiceCloneMetadata: (voiceCloneResult as any).metadata,
          geminiMetadata: geminiResult.error ? null : (geminiResult as any).metadata,
          ttsMetadata: ttsResult.metadata
        }, req);

        logger.info('🎉 Full voice processing pipeline completed successfully!');

        // Step 4: Clean up - delete the temporary voice clone
        logger.info(`🧹 Step 4: Cleaning up voice clone ${voiceId}...`);
        try {
          const deleteResult = await voiceService.deleteVoice(voiceId) as { error?: string };
          if (deleteResult.error) {
            logger.warn(`⚠️ Warning: Could not delete voice clone ${voiceId}: ${deleteResult.error}`);
          } else {
            logger.info(`✅ Voice clone ${voiceId} deleted successfully`);
          }
        } catch (cleanupError: any) {
          logger.warn(`⚠️ Warning: Voice cleanup failed: ${cleanupError.message}`);
        }

      } catch (error: unknown) {
        logger.error('❌ Pipeline error:', error as Error);
        const errorMessage = extractErrorMessage(error);
        await taskStore.set(taskId, {
          status: 'error',
          error: errorMessage
        });
      }
    });
  }
}

export default new TranscriptionUploadRoutes();
