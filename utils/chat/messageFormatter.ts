import conversationManager from '../../services/conversationManager';

/**
 * Green API message structure (partial)
 */
export interface GreenApiMessage {
    idMessage?: string;
    typeMessage?: string;
    textMessage?: string;
    caption?: string;
    extendedTextMessage?: {
        text?: string;
    };
    imageMessageData?: {
        downloadUrl?: string;
    };
    videoMessageData?: {
        downloadUrl?: string;
    };
    audioMessageData?: {
        downloadUrl?: string;
    };
    downloadUrl?: string;
    urlFile?: string;
    senderName?: string;
    timestamp?: number;
    type?: string;
}

/**
 * Internal message format
 */
export interface InternalMessage {
    role: 'assistant' | 'user';
    content: string;
    metadata: {
        hasImage?: boolean;
        hasVideo?: boolean;
        hasAudio?: boolean;
        imageUrl?: string;
        videoUrl?: string;
        audioUrl?: string;
    };
    timestamp: number;
}

/**
 * Format message for display (readable string)
 * @param msg - Green API message
 * @param idx - Index for referencing
 * @param chatId - Chat ID
 */
export async function formatDisplayMessage(msg: GreenApiMessage, idx: number, chatId: string): Promise<string> {
    const isFromBot = msg.idMessage ? await conversationManager.isBotMessage(chatId, msg.idMessage) : false;
    const role = isFromBot ? 'בוט' : 'משתמש';
    const senderName = msg.senderName || (isFromBot ? 'בוט' : 'משתמש');

    const textContent = msg.textMessage ||
        msg.caption ||
        (msg.extendedTextMessage && msg.extendedTextMessage.text) ||
        (msg.typeMessage === 'extendedTextMessage' && msg.extendedTextMessage?.text);

    let content = '';
    if (textContent && textContent.trim()) {
        content = `${role} (${senderName}): ${textContent}`;
    } else {
        content = `${role} (${senderName}): [הודעה ללא טקסט]`;
    }

    // Add media indicators
    if (msg.typeMessage === 'imageMessage' || msg.typeMessage === 'image') {
        const imageUrl = msg.downloadUrl || msg.urlFile || msg.imageMessageData?.downloadUrl;
        if (imageUrl) {
            content += ` [תמונה: image_id=${idx}, url=${imageUrl}]`;
        } else {
            content += ' [תמונה מצורפת]';
        }
    }

    if (msg.typeMessage === 'videoMessage' || msg.typeMessage === 'video') {
        const videoUrl = msg.downloadUrl || msg.urlFile || msg.videoMessageData?.downloadUrl;
        if (videoUrl) {
            content += ` [וידאו: video_id=${idx}, url=${videoUrl}]`;
        } else {
            content += ' [וידאו מצורף]';
        }
    }

    if (msg.typeMessage === 'audioMessage' || msg.typeMessage === 'audio') {
        const audioUrl = msg.downloadUrl || msg.urlFile || msg.audioMessageData?.downloadUrl;
        if (audioUrl) {
            content += ` [אודיו: audio_id=${idx}, url=${audioUrl}]`;
        } else {
            content += ' [הקלטה קולית]';
        }
    }

    // Add timestamp if available
    if (msg.timestamp) {
        const date = new Date(msg.timestamp * 1000);
        content += ` [${date.toLocaleString('he-IL')}]`;
    }

    return content;
}

/**
 * Format history to internal format
 * @param history - Green API history array
 * @param chatId - Chat ID
 * @returns Internal format messages
 */
export async function formatInternal(history: GreenApiMessage[], chatId: string): Promise<InternalMessage[]> {
    const formatted: InternalMessage[] = [];
    for (const msg of history) {
        const isFromBot = msg.idMessage ? await conversationManager.isBotMessage(chatId, msg.idMessage) : false;

        const textContent = msg.textMessage ||
            msg.caption ||
            (msg.extendedTextMessage && msg.extendedTextMessage.text) ||
            (msg.typeMessage === 'extendedTextMessage' && msg.extendedTextMessage?.text);

        const metadata: InternalMessage['metadata'] = {};
        if (msg.typeMessage === 'imageMessage' || msg.typeMessage === 'image') {
            metadata.hasImage = true;
            metadata.imageUrl = msg.downloadUrl || msg.urlFile || msg.imageMessageData?.downloadUrl;
        }
        if (msg.typeMessage === 'videoMessage' || msg.typeMessage === 'video') {
            metadata.hasVideo = true;
            metadata.videoUrl = msg.downloadUrl || msg.urlFile || msg.videoMessageData?.downloadUrl;
        }
        if (msg.typeMessage === 'audioMessage' || msg.typeMessage === 'audio') {
            metadata.hasAudio = true;
            metadata.audioUrl = msg.downloadUrl || msg.urlFile || msg.audioMessageData?.downloadUrl;
        }

        formatted.push({
            role: isFromBot ? 'assistant' : 'user',
            content: textContent || '',
            metadata: Object.keys(metadata).length > 0 ? metadata : {},
            timestamp: msg.timestamp || Date.now()
        });
    }
    return formatted;
}
