import { Tool } from './types';

export const locationTools: Record<string, Tool> = {
    send_location: {
        name: 'send_location',
        category: 'location',
        description: 'Send location to WhatsApp. Use this when user asks to send location, share location, or get location in a specific area/region.',
        usage: ['שלח מיקום', 'send location', 'מיקום באזור X', 'שלח מיקום באזור', 'location in X', 'share location'],
        parameters: {
            region: { type: 'string', required: false, description: 'Specific region/city (optional)' }
        },
        critical: 'ALWAYS use send_location for location requests. Do NOT use search_google_drive or other tools for location requests! If user asks for location in a region (e.g., "מיקום באזור סלובניה"), use send_location with region parameter.',
        historyContext: {
            ignore: true,
            reason: 'Location requests are self-contained. Only use history if user explicitly references previous location conversation (e.g., "שלח את המיקום ששאלתי עליו קודם").'
        }
    }
};
