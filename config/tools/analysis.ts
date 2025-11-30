import { Tool } from './types';

export const analysisTools: Record<string, Tool> = {
    analyze_image: {
        name: 'analyze_image',
        category: 'analysis',
        description: 'Analyze/describe image',
        usage: ['מה בתמונה', 'what is in this image', 'תאר את התמונה'],
        parameters: {
            image_url: { type: 'string', required: true, description: 'Image URL to analyze' },
            question: { type: 'string', required: false, description: 'Specific question about image' }
        },
        historyContext: {
            ignore: false,
            reason: 'If image_url is provided in prompt, ignore history. If image_url is missing, use history to find the image from previous messages.'
        }
    },

    analyze_image_from_history: {
        name: 'analyze_image_from_history',
        category: 'analysis',
        description: 'Analyze quoted/previous image from chat history',
        usage: ['quoted image + question'],
        parameters: {
            question: { type: 'string', required: true, description: 'Question about the image' }
        },
        historyContext: {
            ignore: false,
            reason: 'This tool REQUIRES history to find the image. Always use history when this tool is called.'
        }
    },

    analyze_video: {
        name: 'analyze_video',
        category: 'analysis',
        description: 'Analyze/describe video',
        usage: ['מה בוידאו', 'what is in this video'],
        parameters: {
            video_url: { type: 'string', required: true, description: 'Video URL to analyze' },
            question: { type: 'string', required: false, description: 'Specific question about video' }
        },
        historyContext: {
            ignore: false,
            reason: 'If video_url is provided in prompt, ignore history. If video_url is missing, use history to find the video from previous messages.'
        }
    }
};
