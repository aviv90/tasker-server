
import { extractProviderFromPrompt, extractDurationFromPrompt } from '../../services/agent/tools/creation/videoCreation';
import { validateVideoDuration } from '../../services/agent/utils/videoDuration';
import { PROVIDERS } from '../../services/agent/config/constants';

describe('Video Creation Helpers', () => {
    describe('extractProviderFromPrompt', () => {
        it('should return Grok for explicit Grok requests', () => {
            expect(extractProviderFromPrompt('create a video with grok')).toBe(PROVIDERS.VIDEO.GROK);
            expect(extractProviderFromPrompt('וידאו עם גרוק')).toBe(PROVIDERS.VIDEO.GROK);
            expect(extractProviderFromPrompt('באמצעות grok')).toBe(PROVIDERS.VIDEO.GROK);
        });

        it('should return Sora for explicit Sora requests', () => {
            expect(extractProviderFromPrompt('with sora')).toBe(PROVIDERS.VIDEO.SORA);
            expect(extractProviderFromPrompt('עם סורה')).toBe(PROVIDERS.VIDEO.SORA);
        });

        it('should return Sora Pro for explicit Sora Pro requests', () => {
            expect(extractProviderFromPrompt('with sora pro')).toBe(PROVIDERS.VIDEO.SORA_PRO);
            expect(extractProviderFromPrompt('עם סורה-פרו')).toBe(PROVIDERS.VIDEO.SORA_PRO);
            expect(extractProviderFromPrompt('sora-pro')).toBe(PROVIDERS.VIDEO.SORA_PRO);
        });

        it('should return Kling for explicit Kling requests', () => {
            expect(extractProviderFromPrompt('with kling')).toBe(PROVIDERS.VIDEO.KLING);
            expect(extractProviderFromPrompt('עם קלינג')).toBe(PROVIDERS.VIDEO.KLING);
        });

        it('should return Veo3 for explicit Veo requests', () => {
            expect(extractProviderFromPrompt('with veo')).toBe(PROVIDERS.VIDEO.VEO3);
            expect(extractProviderFromPrompt('עם ויאו')).toBe(PROVIDERS.VIDEO.VEO3);
            expect(extractProviderFromPrompt('veo 3')).toBe(PROVIDERS.VIDEO.VEO3);
        });

        it('should return null if no provider mentioned', () => {
            expect(extractProviderFromPrompt('create a video of a cat')).toBeNull();
            expect(extractProviderFromPrompt('סרטון של חתול')).toBeNull();
        });
    });

    describe('extractDurationFromPrompt', () => {
        it('should extract duration from Hebrew text', () => {
            expect(extractDurationFromPrompt('סרטון 15 שניות')).toBe(15);
            expect(extractDurationFromPrompt('באורך 10 שניות')).toBe(10);
            expect(extractDurationFromPrompt('15שניות')).toBe(15);
            expect(extractDurationFromPrompt('למשך 5 שנ\'')).toBe(5);
        });

        it('should extract duration from English text', () => {
            expect(extractDurationFromPrompt('15 seconds video')).toBe(15);
            expect(extractDurationFromPrompt('5s clip')).toBe(5);
            expect(extractDurationFromPrompt('duration: 10')).toBe(10);
            expect(extractDurationFromPrompt('length 20')).toBe(20);
        });

        it('should return null if no duration found', () => {
            expect(extractDurationFromPrompt('video of a cat')).toBeNull();
            expect(extractDurationFromPrompt('סרטון של חתול')).toBeNull();
        });
    });

    describe('validateVideoDuration', () => {
        // Grok: range 1-15, default 15
        it('should validate Grok duration (Range)', () => {
            expect(validateVideoDuration(PROVIDERS.VIDEO.GROK, 5)).toEqual({ duration: 5 });
            expect(validateVideoDuration(PROVIDERS.VIDEO.GROK, 15)).toEqual({ duration: 15 });
            expect(validateVideoDuration(PROVIDERS.VIDEO.GROK, 20).error).toBeDefined(); // Error if > 15
            expect(validateVideoDuration(PROVIDERS.VIDEO.GROK, undefined)).toEqual({ duration: 15 }); // Default
        });

        // Veo3: discrete [4, 6, 8], default 8, tolerance 2
        it('should validate Veo3 duration (Discrete with tolerance)', () => {
            expect(validateVideoDuration(PROVIDERS.VIDEO.VEO3, 4)).toEqual({ duration: 4 });
            expect(validateVideoDuration(PROVIDERS.VIDEO.VEO3, 6)).toEqual({ duration: 6 });
            expect(validateVideoDuration(PROVIDERS.VIDEO.VEO3, 8)).toEqual({ duration: 8 });

            // Tolerance snapping (within 2s)
            // 5 is equidistant to 4 and 6. Implementation prefers limits.values order/first match (4).
            expect(validateVideoDuration(PROVIDERS.VIDEO.VEO3, 5)).toEqual({ duration: 4 });
            expect(validateVideoDuration(PROVIDERS.VIDEO.VEO3, 3)).toEqual({ duration: 4 }); // 3 -> 4
            expect(validateVideoDuration(PROVIDERS.VIDEO.VEO3, 7)).toEqual({ duration: 6 }); // 7 -> 6

            // Out of tolerance
            expect(validateVideoDuration(PROVIDERS.VIDEO.VEO3, 15).error).toBeDefined(); // 15 is too far from 8
            expect(validateVideoDuration(PROVIDERS.VIDEO.VEO3, 1).error).toBeDefined(); // 1 is too far from 4 (diff 3)

            expect(validateVideoDuration(PROVIDERS.VIDEO.VEO3, undefined)).toEqual({ duration: 8 }); // Default
        });

        // Sora Pro: range 1-25, default 15
        it('should validate Sora Pro duration', () => {
            expect(validateVideoDuration(PROVIDERS.VIDEO.SORA_PRO, 25)).toEqual({ duration: 25 });
            expect(validateVideoDuration(PROVIDERS.VIDEO.SORA_PRO, 30).error).toBeDefined();
        });
    });
});
