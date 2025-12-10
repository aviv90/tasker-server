import { AgentTool } from '../types';
import { remix_voice } from '../../../config/tools/voice/remix'; // or tools-list if we centralized it
import { handleRemixVoice } from './voice/remixHandler';

export const edit_voice_style: AgentTool = {
    declaration: remix_voice as any, // Cast if type mismatch or just use config
    execute: async (args: any, context: any) => {
        return await handleRemixVoice(args.style_description, context);
    }
};
