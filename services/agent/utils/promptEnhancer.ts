import { generateTextResponse } from '../../gemini/textOperations';
import logger from '../../../utils/logger';

// Simple LRU Cache for prompts to avoid redundant LLM calls
class PromptCache {
    private cache = new Map<string, string>();
    private readonly MAX_SIZE = 100;

    get(key: string): string | undefined {
        if (!this.cache.has(key)) return undefined;
        // Refresh item (LRU behavior)
        const val = this.cache.get(key)!;
        this.cache.delete(key);
        this.cache.set(key, val);
        return val;
    }

    set(key: string, value: string): void {
        if (this.cache.size >= this.MAX_SIZE) {
            // Remove oldest (first item in Map)
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) {
                this.cache.delete(oldestKey);
            }
        }
        this.cache.set(key, value);
    }
}

const promptCache = new PromptCache();

/**
 * Enhanced Prompt Service with Caching
 * Uses Gemini Flash to upscale simple prompts into detailed/creative ones.
 * 
 * @param prompt - Original user prompt
 * @param type - 'image' or 'video'
 * @param style - Optional style hint
 * @returns The enhanced prompt
 */
export async function enhancePrompt(
    prompt: string,
    type: 'image' | 'video' = 'image',
    style?: string
): Promise<string> {
    // 0. Cache Check
    const cacheKey = `${type}:${prompt.trim().toLowerCase()}${style ? `:${style.trim().toLowerCase()}` : ''}`;
    const cached = promptCache.get(cacheKey);
    if (cached) {
        logger.info(`⚡ [Magic Prompt] Cache Hit for "${prompt.substring(0, Math.min(prompt.length, 20))}..."`);
        return cached;
    }

    // 1. Validation: Don't enhance if already detailed or too short/long
    // If prompt is too short (<3 chars) or too long (>500 chars), skip enhancement.
    // Also, if it's already long (>50 words), skip to respect user intent.
    if (!prompt || prompt.length < 3 || prompt.length > 500 || prompt.split(' ').length > 50) {
        return prompt;
    }

    try {
        logger.info(`✨ [Magic Prompt] Enhancing ${type} prompt: "${prompt}"...`);

        // 2. Build System Prompt for Upscaling
        let systemPrompt = `You are a professional Prompt Engineer. 
Your goal is to rewrite the user's raw prompt into a highly detailed, professional ${type} generation prompt.

Keep the main subject exactly as requested.
Add relevant details like lighting, texture, camera angle, atmosphere, resolution (8k), highly detailed.

If a style is provided (${style || 'none'}), enforce it strictly.
Output ONLY the raw prompt. No prefix like "Here is the prompt:".

User Prompt: "${prompt}"`;

        if (type === 'video') {
            systemPrompt += `\nInclude motion details, camera movement, and frame consistency directives.`;
        }

        // 3. Call Fast LLM (Gemini Flash via generateTextResponse)
        const result = await generateTextResponse(systemPrompt);

        // 4. Validate output
        if (result.error || !result.text || result.text.length < prompt.length) {
            return prompt; // Fallback if generation failed
        }

        const enhanced = result.text.trim().replace(/^"|"$/g, ''); // Remove quotes if present

        logger.info(`✨ Prompt Upscaling [${type}]:`, {
            original: prompt,
            enhanced: enhanced
        });

        // 5. Save to Cache
        promptCache.set(cacheKey, enhanced);

        return enhanced;
    } catch (err: unknown) {
        logger.warn('⚠️ Prompt enhancement failed (fallback to original)', { error: err });
        return prompt;
    }
}
