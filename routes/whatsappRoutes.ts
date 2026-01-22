import express, { Request, Response } from 'express';
import NodeCache from 'node-cache';
import { whatsappLimiter } from '../middleware/rateLimiter';
import logger from '../utils/logger';
import { handleIncomingMessage } from './whatsapp/incomingHandler';
import { handleOutgoingMessage } from './whatsapp/outgoingHandler';

const router = express.Router();

// Message deduplication cache using NodeCache with TTL (5 minutes)
// This is more performant and memory-safe than a manual Set
const processedMessagesCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

/**
 * Webhook endpoint for receiving WhatsApp messages from Green API
 * Higher rate limit for legitimate WhatsApp traffic
 */
router.post('/webhook', whatsappLimiter, async (req: Request, res: Response) => {
  try {
    // Security check: Verify webhook token
    const token = (req.headers['authorization'] as string)?.replace('Bearer ', '') ||
      (req.query.token as string) ||
      req.body.token;

    const expectedToken = process.env.GREEN_API_WEBHOOK_TOKEN;

    if (!expectedToken) {
      logger.error('❌ GREEN_API_WEBHOOK_TOKEN not configured in environment');
      res.status(500).json({ error: 'Webhook token not configured' });
      return;
    }

    if (token !== expectedToken) {
      logger.error('❌ Unauthorized webhook request - invalid token');
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const webhookData = req.body;

    // Log full webhook payload for debugging
    logger.debug(`📱 Green API webhook: ${webhookData.typeWebhook || 'unknown'} | Type: ${webhookData.messageData?.typeMessage || 'N/A'}`);

    // Handle different webhook types asynchronously
    if (webhookData.typeWebhook === 'incomingMessageReceived') {
      // Process in background - don't await
      handleIncomingMessage(webhookData, processedMessagesCache).catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        logger.error('❌ Error in async webhook processing:', { error: errorMessage, stack: errorStack });
      });
    } else if (webhookData.typeWebhook === 'outgoingMessageReceived') {
      // Process outgoing messages (commands sent by you)
      handleOutgoingMessage(webhookData, processedMessagesCache).catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        logger.error('❌ Error in async outgoing message processing:', { error: errorMessage, stack: errorStack });
      });
    }

    // Return 200 OK immediately
    res.status(200).json({ status: 'ok' });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Error processing webhook:', errorMessage);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
