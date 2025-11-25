export interface WebhookData {
  typeWebhook: string;
  instanceData: {
    idInstance: number;
    wid: string;
    typeInstance: string;
  };
  timestamp: number;
  idMessage: string;
  senderData: {
    chatId: string;
    sender: string;
    senderName: string;
    senderContactName?: string;
    chatName?: string;
  };
  messageData: {
    typeMessage: string;
    textMessageData?: {
      textMessage: string;
    };
    extendedTextMessageData?: {
      text: string;
      description?: string;
      title?: string;
      previewType?: string;
      jpegThumbnail?: string;
    };
    quotedMessage?: any;
    fileMessageData?: {
      downloadUrl: string;
      fileName: string;
      mimeType: string;
    };
    audioMessageData?: {
      downloadUrl: string;
      duration: number;
    };
    downloadUrl?: string; // Some messages have it directly
    stanzaId?: string; // For quotes
    [key: string]: any;
  };
  [key: string]: any;
}

