/**
 * Sound Effects Agent Tool
 * Generate sound effects from text descriptions using ElevenLabs
 */

import voiceService from '../../../voiceService';
import logger from '../../../../utils/logger';
import { REQUIRED, FAILED, ERROR } from '../../../../config/messages';
import { createTool } from '../base';

type CreateSoundEffectArgs = {
    text: string;
    duration_seconds?: number;
    loop?: boolean;
};

type SoundEffectResult = {
    error?: string;
    audioUrl?: string;
};

/**
 * Tool: Create Sound Effect
 * Generates sound effects from text descriptions
 */
export const create_sound_effect = createTool<CreateSoundEffectArgs>(
    {
        name: 'create_sound_effect',
        description: `Generate sound effects/audio effects from a description. Use when user asks for sounds like:
- "צור צליל של פיצוץ" → generate explosion sound
- "שלח קול של גשם" → generate rain falling sound  
- "צור אפקט קולי של צעדים" → generate footsteps sound
- "צליל של חתול" → generate cat meowing sound
- "קול של פיל" → generate elephant trumpeting sound
CRITICAL: The 'text' parameter must be a descriptive sound effect prompt IN ENGLISH, not Hebrew.
Convert the user's request to an English sound description. Example: "צליל של חתול" → text: "cat meowing sound"
NOT for speech/TTS - use text_to_speech for spoken words.`,
        parameters: {
            type: 'object',
            properties: {
                text: {
                    type: 'string',
                    description: 'ENGLISH description of the sound effect to generate. Examples: "cat meowing", "explosion boom", "rain on roof", "footsteps on gravel", "thunder rumble", "elephant trumpeting". MUST be in English for best results.'
                },
                duration_seconds: {
                    type: 'number',
                    description: 'Duration in seconds (0.5-30). If not specified, auto-detected from prompt.'
                },
                loop: {
                    type: 'boolean',
                    description: 'Whether the sound should loop smoothly (useful for ambient sounds like rain, fire, etc.)'
                }
            },
            required: ['text']
        }
    },
    async (args, context) => {
        logger.debug(`🔧 [Agent Tool] create_sound_effect called: "${args.text?.substring(0, 50)}..."`);

        try {
            // Validate input
            if (!args.text || args.text.trim().length === 0) {
                return {
                    success: false,
                    error: REQUIRED.SOUND_EFFECT_DESCRIPTION
                };
            }

            // Build options
            const options: {
                durationSeconds?: number;
                loop?: boolean;
            } = {};

            if (args.duration_seconds !== undefined) {
                options.durationSeconds = args.duration_seconds;
            }

            if (args.loop !== undefined) {
                options.loop = args.loop;
            }

            // Generate sound effect
            const result = (await voiceService.generateSoundEffect(
                args.text.trim(),
                options
            )) as SoundEffectResult;

            if (result.error) {
                return {
                    success: false,
                    error: FAILED.SOUND_EFFECT(result.error)
                };
            }

            return {
                success: true,
                data: '✅ האפקט הקולי נוצר בהצלחה!',
                audioUrl: result.audioUrl
            };
        } catch (error) {
            const err = error as Error;
            logger.error('❌ Error in create_sound_effect:', {
                error: err.message,
                stack: err.stack,
                text: args.text?.substring(0, 100),
                chatId: context.chatId
            });
            return {
                success: false,
                error: ERROR.generic(err.message)
            };
        }
    }
);
