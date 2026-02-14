/**
 * Video Duration Validation Utility
 * SSOT for allowed video durations per provider.
 */

import { PROVIDERS } from '../config/constants';

/**
 * Per-provider duration limits
 * - range: continuous range (any integer within min–max)
 * - discrete: only specific values allowed
 */
export const VIDEO_DURATION_LIMITS: Record<string, {
    type: 'range' | 'discrete';
    values: number[];
    default: number;
    label: string;
}> = {
    [PROVIDERS.VIDEO.GROK]: {
        type: 'range',
        values: [1, 15], // min, max
        default: 15,
        label: '1-15'
    },
    [PROVIDERS.VIDEO.KLING]: {
        type: 'discrete',
        values: [5, 10],
        default: 5,
        label: '5 או 10'
    },
    [PROVIDERS.VIDEO.VEO3]: {
        type: 'discrete',
        values: [4, 6, 8],
        default: 8,
        label: '4, 6 או 8'
    },
    [PROVIDERS.VIDEO.SORA]: {
        type: 'range',
        values: [1, 15], // min, max
        default: 15,
        label: '1-15'
    },
    [PROVIDERS.VIDEO.SORA_PRO]: {
        type: 'range',
        values: [1, 25], // min, max
        default: 15,
        label: '1-25'
    }
};

/**
 * Validate and normalize video duration for a given provider.
 * @returns validated duration number, or an error string if invalid
 */
export function validateVideoDuration(
    provider: string,
    duration: number | undefined
): { duration: number; error?: undefined } | { duration?: undefined; error: string } {
    const limits = VIDEO_DURATION_LIMITS[provider];

    // Provider has no duration support — use provider default or ignore
    if (!limits) {
        return { duration: duration ?? 0 };
    }

    // No duration requested — use provider default
    if (duration === undefined || duration === null) {
        return { duration: limits.default };
    }

    const rounded = Math.round(duration);

    if (limits.type === 'range') {
        const min = limits.values[0]!;
        const max = limits.values[1]!;
        if (rounded < min || rounded > max) {
            return {
                error: `${limits.label}`
            };
        }
        return { duration: rounded };
    }

    // Discrete values
    if (!limits.values.includes(rounded)) {
        // Tolerant: try to snap to nearest valid value
        const nearest = limits.values.reduce((prev, curr) =>
            Math.abs(curr - rounded) < Math.abs(prev - rounded) ? curr : prev
        );
        // Only snap if within reasonable distance (±2 seconds)
        if (Math.abs(nearest - rounded) <= 2) {
            return { duration: nearest };
        }
        return {
            error: `${limits.label}`
        };
    }

    return { duration: rounded };
}
