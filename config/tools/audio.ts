import { Tool } from './types';

export const audioTools: Record<string, Tool> = {
    text_to_speech: {
        name: 'text_to_speech',
        category: 'audio',
        description: 'Convert text to speech (NO translation)',
        usage: ['אמור X', 'say X', 'תקרא בקול'],
        parameters: {
            text: { type: 'string', required: true, description: 'Text to speak' },
            voice: { type: 'string', required: false, description: 'Voice style' }
        },
        critical: 'Use ONLY if user explicitly requests audio ("אמור", "תשמיע", "voice", "say")',
        historyContext: {
            ignore: true,
            reason: 'Text-to-speech requests are self-contained. Only use history if user references previous text (e.g., "אמור את מה שכתבתי קודם").'
        }
    },

    translate_and_speak: {
        name: 'translate_and_speak',
        category: 'audio',
        description: 'Translate text to target language AND convert to speech',
        usage: ['אמור X ב-Y', 'say X in Y', 'תרגם ל-Y ואמור'],
        parameters: {
            text: { type: 'string', required: true, description: 'Text to translate and speak' },
            target_language: { type: 'string', required: true, description: 'Target language (e.g., English, עברית)' }
        },
        critical: 'Use ONLY when user EXPLICITLY states BOTH text AND target language (e.g., "אמור X בערבית"). Do NOT guess target language! Do NOT use based on previous commands!',
        historyContext: {
            ignore: true,
            reason: 'Translation requests are self-contained. Only use history if user references previous text (e.g., "תרגם את מה שכתבתי קודם").'
        }
    },

    translate_text: {
        name: 'translate_text',
        category: 'translation',
        description: 'Translate text (NO speech)',
        usage: ['תרגם ל-X', 'translate to X'],
        parameters: {
            text: { type: 'string', required: true, description: 'Text to translate' },
            target_language: { type: 'string', required: true, description: 'Target language' }
        },
        historyContext: {
            ignore: true,
            reason: 'Translation requests are self-contained. Only use history if user references previous text (e.g., "תרגם את מה שכתבתי קודם").'
        }
    },

    transcribe_audio: {
        name: 'transcribe_audio',
        category: 'audio',
        description: 'Convert speech to text',
        usage: ['תמלל הקלטה', 'transcribe audio'],
        parameters: {
            audio_url: { type: 'string', required: true, description: 'Audio file URL' }
        },
        historyContext: {
            ignore: false,
            reason: 'If audio_url is provided in prompt, ignore history. If audio_url is missing, use history to find the audio from previous messages.'
        }
    },

    voice_clone_and_speak: {
        name: 'voice_clone_and_speak',
        category: 'audio',
        description: 'Clone voice from audio and speak text',
        usage: ['דבר בקול של X'],
        parameters: {
            reference_audio_url: { type: 'string', required: true, description: 'Reference voice audio' },
            text_to_speak: { type: 'string', required: true, description: 'Text to speak' }
        },
        historyContext: {
            ignore: false,
            reason: 'If reference_audio_url is provided in prompt, ignore history. If reference_audio_url is missing, use history to find the audio from previous messages.'
        }
    },

    creative_audio_mix: {
        name: 'creative_audio_mix',
        category: 'audio',
        description: 'Mix/combine audio files creatively',
        usage: ['ערבב אודיו'],
        parameters: {
            audio_urls: { type: 'array', required: true, description: 'Audio files to mix' },
            instruction: { type: 'string', required: true, description: 'How to mix' }
        },
        historyContext: {
            ignore: false,
            reason: 'If audio_urls are provided in prompt, ignore history. If audio_urls are missing, use history to find the audio files from previous messages.'
        }
    }
};
