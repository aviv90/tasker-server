import { Tool } from './types';

export const creationTools: Record<string, Tool> = {
    create_image: {
        name: 'create_image',
        category: 'creation',
        description: 'Create NEW image with AI. Supports providers: gemini (default), openai, grok. Use this for NEW image requests, even if user specifies provider like "with OpenAI" or "עם Gemini". Do NOT use retry_last_command for new image requests!',
        usage: ['צור תמונה', 'שלח תמונה', 'תמונה של', 'create image', 'send image', 'draw X', 'image of X', 'צור תמונה עם OpenAI', 'create image with Gemini'],
        parameters: {
            prompt: { type: 'string', required: true, description: 'Image description' },
            provider: { type: 'string', required: false, description: 'Optional. LEAVE EMPTY for default (Gemini). Only set if user explicitly asks for "OpenAI" or "Grok".' }
        },
        critical: 'Use for ANY request to create/send/make an image. "שלח תמונה של X" means CREATE image, not search! If user requests NEW image with provider, use create_image with provider parameter, NOT retry_last_command!',
        historyContext: {
            ignore: true,
            reason: 'Image creation requests are self-contained. Only use history if user explicitly references previous image conversation (e.g., "צור תמונה דומה לזו ששלחתי קודם").'
        }
    },

    create_video: {
        name: 'create_video',
        category: 'creation',
        description: 'Create NEW video with AI. Default provider: Veo 3 (Google). Other providers: sora/sora-pro (OpenAI), kling, grok. CRITICAL: If user says "עם Grok"/"with Grok"/"באמצעות גרוק" etc, you MUST set provider="grok". Do NOT ignore provider requests!',
        usage: ['צור וידאו', 'create video', 'make video of X', 'צור וידאו עם Veo 3', 'create video with Sora', 'וידאו עם Grok', 'video with grok'],
        parameters: {
            prompt: { type: 'string', required: true, description: 'Video description' },
            provider: { type: 'string', required: false, description: 'CRITICAL: Extract provider from user request! If user says "Grok"/"גרוק" → set "grok". If "Sora"/"סורה" → set "sora". If "Kling"/"קלינג" → set "kling". Leave empty ONLY if no provider mentioned.' }
        },
        historyContext: {
            ignore: true,
            reason: 'Video creation requests are self-contained. Only use history if user explicitly references previous video conversation.'
        }
    },

    image_to_video: {
        name: 'image_to_video',
        category: 'creation',
        description: 'Convert/animate image to video (when image is attached). Default provider: Veo 3 (Google). Other providers: sora/sora-pro (OpenAI), kling, grok. CRITICAL: If user says "עם Grok"/"with Grok"/"באמצעות גרוק" etc, you MUST set provider="grok". Do NOT ignore provider requests!',
        usage: ['הפוך לווידאו', 'הפוך תמונה לוידאו', 'animate', 'animate image', 'make video from image', 'convert to video', 'הפוך לווידאו עם Veo 3', 'animate with Grok'],
        parameters: {
            image_url: { type: 'string', required: true, description: 'Image URL' },
            prompt: { type: 'string', required: false, description: 'Animation instructions' },
            provider: { type: 'string', required: false, description: 'CRITICAL: Extract provider from user request! If user says "Grok"/"גרוק" → set "grok". If "Sora"/"סורה" → set "sora". If "Kling"/"קלינג" → set "kling". Leave empty ONLY if no provider mentioned.' }
        },
        critical: 'Use ONLY when user attached an image and wants to animate/convert it to video. NOT for creating new videos! If user requests NEW image-to-video conversion with provider, use image_to_video with provider parameter, NOT retry_last_command!',
        historyContext: {
            ignore: false,
            reason: 'If image_url is provided in prompt, ignore history. If image_url is missing, use history to find the image from previous messages.'
        }
    },

    create_music: {
        name: 'create_music',
        category: 'creation',
        description: 'Create NEW song/music with Suno AI (with melody). Use ONLY for "צור שיר" / "create song" / "make music" / "song with melody". Do NOT use for "כתוב שיר" / "write song" (text only - no tool needed).',
        usage: ['צור שיר', 'יצירת שיר', 'שיר עם מנגינה', 'create song', 'make music', 'generate song'],
        parameters: {
            prompt: { type: 'string', required: true, description: 'Song description/lyrics' },
            make_video: { type: 'boolean', required: false, description: 'Also create music video' }
        },
        critical: 'Use ONLY for creating NEW songs. For EXISTING songs, use search_web! If user requests NEW song/music, use create_music, NOT retry_last_command!',
        historyContext: {
            ignore: true,
            reason: 'Music creation requests are self-contained. Only use history if user explicitly references previous music conversation.'
        }
    },

    create_poll: {
        name: 'create_poll',
        category: 'creation',
        description: 'Create WhatsApp poll',
        usage: ['צור סקר', 'create poll'],
        parameters: {
            topic: { type: 'string', required: true, description: 'Poll topic' },
            num_options: { type: 'number', required: false, description: 'Number of options (2-12)' },
            with_rhyme: { type: 'boolean', required: false, description: 'Make options rhyme' }
        },
        historyContext: {
            ignore: false,
            reason: 'Use history if user references previous conversation topic for the poll. If topic is clear and self-contained, ignore history.'
        }
    },

    create_group: {
        name: 'create_group',
        category: 'creation',
        description: 'Create WhatsApp group with participants. Only available for authorized users.',
        usage: ['צור קבוצה', 'create group', 'צור קבוצה עם המשפחה'],
        parameters: {
            group_name: { type: 'string', required: true, description: 'Group name' },
            participants_description: { type: 'string', required: false, description: 'Participants description (e.g., "all family members", "work team")' }
        },
        historyContext: {
            ignore: false,
            reason: 'Use history if user references previous conversation about participants or group purpose. If request is clear and self-contained, ignore history.'
        }
    }
};
