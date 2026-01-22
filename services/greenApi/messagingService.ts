/**
 * Green API Messaging Service
 * Encapsulates messaging logic with Dependency Injection to avoid circular dependencies.
 */

import axios from 'axios';
import { BASE_URL, GREEN_API_API_TOKEN_INSTANCE } from './constants';
import { TIME } from '../../utils/constants';
import logger from '../../utils/logger';

// Interfaces for dependencies
interface MessageTypesManager {
    markAsBotMessage(chatId: string, messageId: string): Promise<void>;
}

interface MessagesManager {
    addMessage(chatId: string, role: string, content: string, metadata?: Record<string, unknown>): Promise<number>;
}

export class GreenApiMessagingService {
    private messageTypesManager: MessageTypesManager;
    private messagesManager: MessagesManager;

    constructor(messageTypesManager: MessageTypesManager, messagesManager: MessagesManager) {
        this.messageTypesManager = messageTypesManager;
        this.messagesManager = messagesManager;
    }

    /**
     * Send text message via Green API
     */
    async sendTextMessage(
        chatId: string,
        message: string,
        quotedMessageId: string | null = null,
        typingTime: number = TIME.TYPING_INDICATOR
    ): Promise<unknown> {
        try {
            const url = `${BASE_URL}/sendMessage/${GREEN_API_API_TOKEN_INSTANCE}`;

            const data: Record<string, unknown> = {
                chatId: chatId,
                message: message,
                typingTime: typingTime
            };

            if (quotedMessageId) {
                data.quotedMessageId = quotedMessageId;
            }

            const response = await axios.post(url, data, {
                headers: { 'Content-Type': 'application/json' }
            });

            logger.info(`📤 Message sent to ${chatId}:`, { message: message.substring(0, 50) + '...' });

            // Mark as bot message
            if (response.data && (response.data as { idMessage?: string }).idMessage) {
                await this.messageTypesManager.markAsBotMessage(chatId, (response.data as { idMessage: string }).idMessage);
            }

            // Save to history
            await this.messagesManager.addMessage(chatId, 'assistant', message, {
                idMessage: (response.data as { idMessage?: string })?.idMessage,
                quotedMessageId
            }).catch((err: unknown) => {
                logger.warn('⚠️ Failed to save outgoing message to DB history', { error: err });
            });

            return response.data;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('❌ Error sending text message:', { error: errorMessage, chatId });
            throw error;
        }
    }

    /**
     * Send file by URL via Green API
     */
    async sendFileByUrl(
        chatId: string,
        fileUrl: string,
        fileName: string,
        caption: string = '',
        quotedMessageId: string | null = null,
        typingTime: number = TIME.TYPING_INDICATOR
    ): Promise<unknown> {
        try {
            const url = `${BASE_URL}/sendFileByUrl/${GREEN_API_API_TOKEN_INSTANCE}`;

            const data: Record<string, unknown> = {
                chatId: chatId,
                urlFile: fileUrl,
                fileName: fileName,
                caption: caption,
                typingTime: typingTime
            };

            if (quotedMessageId) {
                data.quotedMessageId = quotedMessageId;
            }

            logger.info(`📤 Sending file: ${fileName} to ${chatId}`);

            const response = await axios.post(url, data, {
                headers: { 'Content-Type': 'application/json' }
            });

            logger.info(`✅ File sent to ${chatId}: ${fileName}${caption ? ' with caption: ' + caption : ''}`);

            if (response.data && (response.data as { idMessage?: string }).idMessage) {
                await this.messageTypesManager.markAsBotMessage(chatId, (response.data as { idMessage: string }).idMessage);
            }

            await this.messagesManager.addMessage(chatId, 'assistant', caption || fileName, {
                idMessage: (response.data as { idMessage?: string })?.idMessage,
                quotedMessageId,
                fileUrl,
                fileName,
                hasMedia: true
            }).catch((err: unknown) => {
                logger.warn('⚠️ Failed to save outgoing file message to DB history', { error: err });
            });

            return response.data;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('❌ Error sending file:', { error: errorMessage, fileName, chatId });
            throw error;
        }
    }

    /**
     * Send poll message via Green API
     */
    async sendPoll(
        chatId: string,
        message: string,
        options: string[],
        multipleAnswers: boolean = false,
        _quotedMessageId: string | null = null,
        typingTime: number = TIME.TYPING_INDICATOR
    ): Promise<unknown> {
        try {
            const url = `${BASE_URL}/sendPoll/${GREEN_API_API_TOKEN_INSTANCE}`;
            const formattedOptions = options.map(opt => ({ optionName: opt }));

            const data: Record<string, unknown> = {
                chatId: chatId,
                message: message,
                options: formattedOptions,
                multipleAnswers: multipleAnswers,
                typingTime: typingTime
                // quotedMessageId intentionally omitted due to Green API issues
            };

            logger.info(`📊 [sendPoll] Sending poll to ${chatId}:`, {
                question: message.substring(0, 50),
                optionsCount: options.length
            });

            const response = await axios.post(url, data, {
                headers: { 'Content-Type': 'application/json' }
            });

            logger.info(`✅ [sendPoll] Poll sent successfully to ${chatId}`);

            if (response.data && (response.data as { idMessage?: string }).idMessage) {
                await this.messageTypesManager.markAsBotMessage(chatId, (response.data as { idMessage: string }).idMessage);
            }

            await this.messagesManager.addMessage(chatId, 'assistant', message, {
                idMessage: (response.data as { idMessage?: string })?.idMessage,
                options,
                isPoll: true
            }).catch((err: unknown) => {
                logger.warn('⚠️ Failed to save outgoing poll message to DB history', { error: err });
            });

            return response.data;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('❌ Error sending poll:', { error: errorMessage, chatId });
            throw error;
        }
    }

    /**
     * Send location message via Green API
     */
    async sendLocation(
        chatId: string,
        latitude: number,
        longitude: number,
        nameLocation: string = '',
        address: string = '',
        quotedMessageId: string | null = null,
        typingTime: number = TIME.TYPING_INDICATOR
    ): Promise<unknown> {
        try {
            const url = `${BASE_URL}/sendLocation/${GREEN_API_API_TOKEN_INSTANCE}`;

            const data: Record<string, unknown> = {
                chatId: chatId,
                latitude: latitude,
                longitude: longitude,
                nameLocation: nameLocation,
                address: address,
                typingTime: typingTime
            };

            if (quotedMessageId) {
                data.quotedMessageId = quotedMessageId;
            }

            const response = await axios.post(url, data, {
                headers: { 'Content-Type': 'application/json' }
            });

            logger.info(`📍 Location sent to ${chatId}: ${latitude}, ${longitude}`);

            if (response.data && (response.data as { idMessage?: string }).idMessage) {
                await this.messageTypesManager.markAsBotMessage(chatId, (response.data as { idMessage: string }).idMessage);
            }

            await this.messagesManager.addMessage(chatId, 'assistant', `Location: ${latitude}, ${longitude}`, {
                idMessage: (response.data as { idMessage?: string })?.idMessage,
                quotedMessageId,
                latitude,
                longitude,
                nameLocation,
                address,
                isLocation: true
            }).catch((err: unknown) => {
                logger.warn('⚠️ Failed to save outgoing location message to DB history', { error: err });
            });

            return response.data;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('❌ Error sending location:', { error: errorMessage, chatId });
            throw error;
        }
    }

    /**
     * Set typing status (Stub)
     */
    async setTyping(_chatId: string): Promise<unknown> {
        return Promise.resolve();
    }
}
