import { Tool } from './types';

export const editingTools: Record<string, Tool> = {
    edit_image: {
        name: 'edit_image',
        category: 'editing',
        description: 'Edit existing image. Supports services: openai (default), gemini. Use this for NEW image editing requests, even if user specifies service like "with OpenAI". Do NOT use retry_last_command for new editing requests!',
        usage: ['ערוך תמונה', 'edit image', 'שנה את התמונה', 'ערוך עם Gemini'],
        parameters: {
            image_url: { type: 'string', required: true, description: 'Image URL to edit' },
            edit_instruction: { type: 'string', required: true, description: 'What to edit' },
            service: { type: 'string', required: false, description: 'Image editing service: openai (default), gemini. If user specifies service like "with Gemini", use service: "gemini".' }
        },
        historyContext: {
            ignore: false,
            reason: 'If image_url is provided in prompt, ignore history. If image_url is missing, use history to find the image from previous messages.'
        }
    },

    edit_video: {
        name: 'edit_video',
        category: 'editing',
        description: 'Edit existing video (Runway only)',
        usage: ['ערוך וידאו', 'edit video', 'change video'],
        parameters: {
            video_url: { type: 'string', required: true, description: 'Video URL to edit' },
            edit_instruction: { type: 'string', required: true, description: 'What to edit' }
        },
        critical: 'Use ONLY for editing existing videos. Provider is always Runway (no other providers supported).',
        historyContext: {
            ignore: false,
            reason: 'If video_url is provided in prompt, ignore history. If video_url is missing, use history to find the video from previous messages.'
        }
    }
};
