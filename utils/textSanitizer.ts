/**
 * Text sanitization utilities for safe AI generation
 */

import { TEXT_LIMITS } from './constants';
import logger from './logger';

/**
 * Error types for validation
 */
export interface ValidationError {
  message: string;
  code: string;
}

/**
 * Sanitize text by removing dangerous characters and normalizing
 * NOTE: Preserves emojis and Unicode characters (including Hebrew, Arabic, etc.)
 * @param text - Text to sanitize
 * @returns Sanitized text
 */
export function sanitizeText(text: unknown): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  // Remove dangerous characters and normalize
  // NOTE: Preserves emojis and Unicode characters (including Hebrew, Arabic, etc.)
  return text
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0E-\x1F\x7F]/g, '') // Remove control characters (but preserve emojis)
    .replace(/\s+/g, ' ') // Normalize whitespace
    .substring(0, TEXT_LIMITS.MAX_SANITIZED_LENGTH); // Limit length
}

/**
 * Clean markdown code blocks and formatting from text
 * Removes markdown code fences (```), inline code (`), and other markdown formatting
 * while preserving the actual content
 * @param text - Text that may contain markdown
 * @returns Cleaned text without markdown formatting
 */
export function cleanMarkdown(text: unknown): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  return text
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks (```...```)
    .replace(/`[^`]*`/g, '') // Remove inline code (`...`)
    .replace(/^\s*```+\s*$/gm, '') // Remove standalone code fence lines
    .replace(/^\s*```+\s*/gm, '') // Remove opening code fences at start of lines
    .replace(/\s*```+\s*$/gm, '') // Remove closing code fences at end of lines
    .replace(/^\s*`+\s*$/gm, '') // Remove lines with only backticks
    .replace(/^\s*`+\s*/gm, '') // Remove leading backticks
    .replace(/\s*`+\s*$/gm, '') // Remove trailing backticks
    .trim();
}

/**
 * Clean media captions/descriptions from markdown, placeholders, and dangling link references
 * Used when sending generated images/videos/audio to WhatsApp
 * @param text - Text that may contain markdown, URLs, or placeholders
 * @returns Cleaned text suitable for media captions
 */
export function cleanMediaDescription(text: unknown, preserveLinks: boolean = false): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  // Step 0: Try to extract content if the whole thing is JSON
  let cleaned = cleanJsonWrapper(text);

  // Step 1: Clean markdown and URLs
  cleaned = cleanMarkdown(cleaned);

  if (!preserveLinks) {
    // CRITICAL: User requested strict NO LINKS policy
    cleaned = cleaned
      .replace(/\[.*?\]\(https?:\/\/[^)]+\)/g, '') // Remove markdown links
      .replace(/https?:\/\/[^\s]+/gi, ''); // Remove plain URLs
  }

  cleaned = cleaned
    .replace(/\[image\]/gi, '')
    .replace(/\[image:[^\]]*\]?/gi, '') // Remove [image: ...] or [image:
    .replace(/\[video\]/gi, '')
    .replace(/\[video:[^\]]*\]?/gi, '') // Remove [video: ...]
    // ... rest of replacements
    .replace(/\[audio\]/gi, '')
    .replace(/\[audio:[^\]]*\]?/gi, '') // Remove [audio: ...]
    .replace(/\[תמונה[^\]]*/gi, '')
    .replace(/תמונה:\s*$/gi, '')
    .replace(/\[וידאו\]/gi, '')
    .replace(/\[אודיו\]/gi, '')
    // System artifacts (Added to fix [Image sent] bug)
    .replace(/\[Image sent\]/gi, '')
    .replace(/\[Video sent\]/gi, '')
    .replace(/\[Audio sent\]/gi, '')
    .replace(/\[Image created\]/gi, '')
    .replace(/\[Video created\]/gi, '')
    .replace(/\[Audio created\]/gi, '')
    .replace(/\[Voice message sent\]/gi, '')
    .replace(/\[Media\]/gi, '')
    // CRITICAL: Remove generic link placeholders (Video Link, Link, etc.)
    .replace(/\[Video Link\]/gi, '')
    .replace(/\[Audio Link\]/gi, '')
    .replace(/\[Image Link\]/gi, '')
    .replace(/\[Music Link\]/gi, '')
    .replace(/\[File Link\]/gi, '')
    .replace(/\[Link\]/gi, '')
    .replace(/\[קישור[^\]]*\]/gi, '') // Hebrew: [קישור...]
    .replace(/\[לינק[^\]]*\]/gi, '') // Hebrew: [לינק...]
    // CRITICAL: Remove [image_id: ...], [video_id: ...], [audio_id: ...] patterns
    .replace(/\[image_id:\s*\d+\]/gi, '')
    .replace(/\[video_id:\s*\d+\]/gi, '')
    .replace(/\[audio_id:\s*\d+\]/gi, '')
    .replace(/\[image_id=\s*\d+\]/gi, '')
    .replace(/\[video_id=\s*\d+\]/gi, '')
    .replace(/\[audio_id=\s*\d+\]/gi, '')
    .replace(/\[תמונה:\s*image_id=[^\]]*\]/gi, '')
    .replace(/\[וידאו:\s*video_id=[^\]]*\]/gi, '')
    .replace(/\[אודיו:\s*audio_id=[^\]]*\]/gi, '')
    // Gemini tool result artifacts
    .replace(/\[audioUrl:[^\]]*\]?/gi, '')
    .replace(/\[imageUrl:[^\]]*\]?/gi, '')
    .replace(/\[videoUrl:[^\]]*\]?/gi, '')
    .replace(/audioUrl:\s*https?:\/\/[^\s\]]+/gi, '')
    .replace(/imageUrl:\s*https?:\/\/[^\s\]]+/gi, '')
    .replace(/videoUrl:\s*https?:\/\/[^\s\]]+/gi, '')
    // CRITICAL: Remove snake_case variants (image_url, video_url, audio_url)
    .replace(/\[image_url:[^\]]*\]?/gi, '')
    .replace(/\[video_url:[^\]]*\]?/gi, '')
    .replace(/\[audio_url:[^\]]*\]?/gi, '')
    .replace(/\[image_url\]/gi, '')
    .replace(/\[video_url\]/gi, '')
    .replace(/\[audio_url\]/gi, '')
    .replace(/image_url:\s*https?:\/\/[^\s\]]+/gi, '')
    .replace(/video_url:\s*https?:\/\/[^\s\]]+/gi, '')
    .replace(/audio_url:\s*https?:\/\/[^\s\]]+/gi, '')
    // CRITICAL: Remove camelCase tags without colon
    .replace(/\[imageUrl\]/gi, '')
    .replace(/\[videoUrl\]/gi, '')
    .replace(/\[audioUrl\]/gi, '')
    // CRITICAL: Remove curly brace variants and truncated artifacts
    .replace(/\{imageUrl:[^}]*\}?/gi, '')
    .replace(/\{videoUrl:[^}]*\}?/gi, '')
    .replace(/\{audioUrl:[^}]*\}?/gi, '')
    // CRITICAL: Remove taskId leakage (internal tool result artifacts)
    .replace(/\{taskId:[^}]*\}?/gi, '') // Remove {taskId: "..."}
    .replace(/taskId:\s*["']?[a-f0-9-]+["']?/gi, '') // Remove taskId: "xxx" or taskId: xxx
    .replace(/\{imageUrl:\s*["']?$/gi, '') // Truncated at end
    .replace(/\{videoUrl:\s*["']?$/gi, '') // Truncated at end
    // CRITICAL: Remove JSON structures and patterns that might be embedded in text
    .replace(/\{[\s\n]*"action":[\s\S]*\}/gi, '') // Remove action JSONs
    .replace(/\{[^{}]*"?\s*(image_?url|imageUrl|video_?url|videoUrl|Image URL|Video URL|revised_?prompt|revisedPrompt)"?[^{}]*\}/gi, '')
    .replace(/"?(image_?url|imageUrl|video_?url|videoUrl|Image URL|Video URL|revised_?prompt|revisedPrompt)"?[:\s]*"[^"]*"/gi, '')
    .replace(/imageUrl:\s*["']?$/gi, '') // Truncated key at end
    .replace(/videoUrl:\s*["']?$/gi, '') // Truncated key at end
    // CRITICAL: Remove internal headers often leaked by Gemini/OpenAI
    .replace(/^(Caption|Description|Image|Revised\s*Prompt|revised_prompt|תנאי|תיאור|תמונה)[:\s]*/gim, '')
    .replace(/✅/g, '')
    .replace(/[[]]/g, '') // Remove remaining square brackets like "]" or "["
    .replace(/[.)},;:-]+$/g, '') // Remove trailing punctuation (., ), }, ;, :, -)
    .replace(/^[,.)},;:-]+/g, ''); // Remove leading punctuation

  // Step 2: Clean up whitespace
  cleaned = cleaned
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Step 3: If nothing meaningful left, return empty string
  if (cleaned.length < 3 || /^[^\w\u0590-\u05FF]+$/.test(cleaned)) {
    return '';
  }

  return cleaned;
}


/**
 * Clean text for multi-step agent responses
 * Removes URLs and media placeholders that shouldn't appear in text messages
 * SSOT for multi-step text cleaning - used by both incoming and outgoing handlers
 * @param text - Text that may contain URLs or placeholders
 * @returns Cleaned text without URLs or placeholders
 */
export function cleanMultiStepText(text: unknown): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  // Step 0: Try to extract content if the whole thing is JSON
  let cleaned = cleanJsonWrapper(text);

  return cleaned
    // CRITICAL: Remove JSON structures and patterns that might be embedded in text
    // DO THIS BEFORE general URL stripping to avoid mangling the JSON
    .replace(/\{[\s\n]*"action":[\s\S]*\}/gi, '') // Remove action JSONs
    .replace(/\{[^{}]*"?\s*(image_?url|imageUrl|video_?url|videoUrl|Image URL|Video URL|revised_?prompt|revisedPrompt)"?[^{}]*\}/gi, '')
    .replace(/"?(image_?url|imageUrl|video_?url|videoUrl|Image URL|Video URL|revised_?prompt|revisedPrompt)"?[:\s]*"[^"]*"/gi, '')
    // CRITICAL: Remove internal headers often leaked by Gemini/OpenAI
    .replace(/^(Caption|Description|Image|Revised\s*Prompt|revised_prompt|תנאי|תיאור|תמונה)[:\s]*/gim, '')
    // CRITICAL: User requested strict NO LINKS policy
    .replace(/https?:\/\/[^\s]+/gi, '') // Remove URLs (image URLs should not be in text)
    .replace(/\[image\]/gi, '')
    .replace(/\[image:[^\]]*\]?/gi, '')
    .replace(/\[video\]/gi, '')
    .replace(/\[video:[^\]]*\]?/gi, '')
    .replace(/\[audio\]/gi, '')
    .replace(/\[audio:[^\]]*\]?/gi, '')
    .replace(/\[תמונה\]/gi, '')
    .replace(/\[וידאו\]/gi, '')
    .replace(/\[אודיו\]/gi, '')
    // System artifacts
    .replace(/\[Image sent\]/gi, '')
    .replace(/\[Video sent\]/gi, '')
    .replace(/\[Audio sent\]/gi, '')
    .replace(/\[Image created\]/gi, '')
    .replace(/\[Video created\]/gi, '')
    .replace(/\[Audio created\]/gi, '')
    .replace(/\[Voice message sent\]/gi, '')
    .replace(/\[Media\]/gi, '')
    // CRITICAL: Remove generic link placeholders (Video Link, Link, etc.)
    .replace(/\[Video Link\]/gi, '')
    .replace(/\[Audio Link\]/gi, '')
    .replace(/\[Image Link\]/gi, '')
    .replace(/\[Music Link\]/gi, '')
    .replace(/\[File Link\]/gi, '')
    .replace(/\[Link\]/gi, '')
    .replace(/\[קישור[^\]]*\]/gi, '') // Hebrew: [קישור...]
    .replace(/\[לינק[^\]]*\]/gi, '') // Hebrew: [לינק...]
    // CRITICAL: Remove [image_id: ...], [video_id: ...], [audio_id: ...] patterns
    // These are internal artifacts that the Agent might hallucinate orparrot back from history
    .replace(/\[image_id:\s*\d+\]/gi, '')
    .replace(/\[video_id:\s*\d+\]/gi, '')
    .replace(/\[audio_id:\s*\d+\]/gi, '')
    .replace(/\[image_id=\s*\d+\]/gi, '')
    .replace(/\[video_id=\s*\d+\]/gi, '')
    .replace(/\[audio_id=\s*\d+\]/gi, '')
    // Also strip localized variants if any
    .replace(/\[תמונה:\s*image_id=[^\]]*\]/gi, '')
    .replace(/\[וידאו:\s*video_id=[^\]]*\]/gi, '')
    .replace(/\[אודיו:\s*audio_id=[^\]]*\]/gi, '')
    // CRITICAL: Remove [audioUrl: ...], [imageUrl: ...], [videoUrl: ...] patterns
    // These are added by Gemini when returning tool results and shouldn't be sent to users
    .replace(/\[audioUrl:[^\]]*\]?/gi, '') // Remove [audioUrl: ...]
    .replace(/\[imageUrl:[^\]]*\]?/gi, '') // Remove [imageUrl: ...]
    .replace(/\[videoUrl:[^\]]*\]?/gi, '') // Remove [videoUrl: ...]
    .replace(/audioUrl:\s*https?:\/\/[^\s\]]+/gi, '') // Remove audioUrl: URL without brackets
    .replace(/imageUrl:\s*https?:\/\/[^\s\]]+/gi, '') // Remove imageUrl: URL without brackets
    .replace(/videoUrl:\s*https?:\/\/[^\s\]]+/gi, '') // Remove videoUrl: URL without brackets
    // CRITICAL: Remove snake_case variants (image_url, video_url, audio_url)
    .replace(/\[image_url:[^\]]*\]?/gi, '')
    .replace(/\[video_url:[^\]]*\]?/gi, '')
    .replace(/\[audio_url:[^\]]*\]?/gi, '')
    .replace(/\[image_url\]/gi, '')
    .replace(/\[video_url\]/gi, '')
    .replace(/\[audio_url\]/gi, '')
    .replace(/image_url:\s*https?:\/\/[^\s\]]+/gi, '')
    .replace(/video_url:\s*https?:\/\/[^\s\]]+/gi, '')
    .replace(/audio_url:\s*https?:\/\/[^\s\]]+/gi, '')
    // CRITICAL: Remove camelCase tags without colon
    .replace(/\[imageUrl\]/gi, '')
    .replace(/\[videoUrl\]/gi, '')
    .replace(/\[audioUrl\]/gi, '')
    // CRITICAL: Remove curly brace variants and truncated artifacts
    .replace(/\{imageUrl:[^}]*\}?/gi, '')
    .replace(/\{videoUrl:[^}]*\}?/gi, '')
    .replace(/\{audioUrl:[^}]*\}?/gi, '')
    // CRITICAL: Remove taskId leakage (internal tool result artifacts)
    .replace(/\{taskId:[^}]*\}?/gi, '') // Remove {taskId: "..."}
    .replace(/taskId:\s*["']?[a-f0-9-]+["']?/gi, '') // Remove taskId: "xxx" or taskId: xxx
    .replace(/\{imageUrl:\s*["']?$/gi, '') // Truncated at end
    .replace(/\{videoUrl:\s*["']?$/gi, '') // Truncated at end
    .replace(/\{audioUrl:\s*["']?$/gi, '') // Truncated at end
    .replace(/imageUrl:\s*["']?$/gi, '') // Truncated key at end
    .replace(/videoUrl:\s*["']?$/gi, '') // Truncated key at end
    .trim();
}

/**
 * Clean Amazon conversational filler
 * If text contains the specific Amazon product header, return only from that header onwards.
 * @param text - Input text
 * @returns Cleaned text
 */
export function cleanAmazonPrefix(text: unknown): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  // Look for the header: "📦 *מוצר אקראי מאמזון:*"
  const match = text.match(/(📦\s*\*מוצר אקראי מאמזון:\*[\s\S]*)/);
  if (match && match[1]) {
    return match[1];
  }
  return text;
}

/**
 * JSON content extraction fields (in priority order)
 */
const JSON_CONTENT_FIELDS = ['answer', 'text', 'message', 'content', 'description', 'revisedPrompt', 'revised_prompt', 'data', 'formatted_address', 'address'] as const;

/**
 * Extract content from parsed JSON object
 * Handles arrays, nested objects (like Google Maps results), and simple objects
 * @param parsed - Parsed JSON object
 * @returns Extracted content string or null
 */
function extractJsonContent(parsed: unknown): string | null {
  // CRITICAL: If the JSON object contains "action" key (like { "action": "create_image", ... }), 
  // it means the Agent leaked a tool call structure instead of executing it. 
  // We MUST suppress this content entirely.
  const actionKeys = ['action', 'tool', 'function', 'name'];
  const hasActionKey = actionKeys.some(key => Object.prototype.hasOwnProperty.call(parsed, key));

  if (hasActionKey) {
    // Check if it looks like a tool call (has action_input, args, parameters, etc.)
    const inputKeys = ['action_input', 'args', 'parameters', 'arguments', 'input'];
    const hasInputKey = inputKeys.some(key => Object.prototype.hasOwnProperty.call(parsed, key));

    if (hasActionKey && (hasInputKey || Object.keys(parsed as object).length < 4)) {
      // It's likely a leaked tool call. Return empty string to suppress it.
      logger.warn('⚠️ [TextSanitizer] Suppressed leaked JSON tool call in output');
      return '';
    }
  }

  // Handle arrays - try to extract from first element
  if (Array.isArray(parsed)) {
    if (parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0] !== null) {
      const firstItem = parsed[0] as Record<string, unknown>;
      // Try content fields on first array element
      for (const field of JSON_CONTENT_FIELDS) {
        const content = firstItem[field];
        if (content && typeof content === 'string' && content.trim().length > 0) {
          return content.trim();
        }
      }
    }
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  // Try priority fields first
  for (const field of JSON_CONTENT_FIELDS) {
    const content = obj[field];
    if (content && typeof content === 'string' && content.trim().length > 0) {
      return content.trim();
    }
  }

  // Handle nested "results" array (common in Google Maps/API responses)
  // Example: {"results": [{"formatted_address": "Tasman Sea", ...}]}
  if (obj.results && Array.isArray(obj.results) && obj.results.length > 0) {
    const firstResult = obj.results[0] as Record<string, unknown> | null;
    if (firstResult && typeof firstResult === 'object') {
      for (const field of JSON_CONTENT_FIELDS) {
        const content = firstResult[field];
        if (content && typeof content === 'string' && content.trim().length > 0) {
          return content.trim();
        }
      }
    }
  }

  // If it's a single-key object with string value, use it
  const keys = Object.keys(obj);
  if (keys.length === 1) {
    const firstKey = keys[0];
    if (firstKey) {
      const value = obj[firstKey];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
  }

  return null;
}

/**
 * Clean JSON wrappers from text responses
 * Removes JSON code blocks and extracts actual content
 * Handles cases like: ```json\n{"answer": "text"}\n``` or {"answer": "text"}
 * @param text - Text that may contain JSON wrapper
 * @returns Cleaned text without JSON wrapper
 */
export function cleanJsonWrapper(text: unknown): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  let cleaned = text.trim();

  // ONLY extract if the entire text looks like JSON (pure object/array or wrapped in code blocks)
  // This prevents accidental extraction from text that just HAPPENS to contain a JSON snippet
  const isWrappedInJson = /^[\s\n]*(```(?:json)?\s*)?(\{[\s\S]*\}|\[[\s\S]*\])(\s*```)?[\s\n]*$/.test(cleaned);
  if (!isWrappedInJson) {
    return cleaned;
  }

  // CRITICAL: If the entire text is a JSON object/array, try to extract meaningful content
  // This handles cases where Gemini returns raw JSON instead of text
  const jsonObjectMatch = cleaned.match(/^[\s\n]*(\{[\s\S]*\}|\[[\s\S]*\])[\s\n]*$/);
  if (jsonObjectMatch && jsonObjectMatch[1]) {
    try {
      const jsonText = jsonObjectMatch[1];
      if (jsonText) {
        const parsed = JSON.parse(jsonText);
        const content = extractJsonContent(parsed);
        if (content !== null) {
          // Note: extractJsonContent now returns '' for suppressed actions, so checks below handle it
          return content.trim().length > 0 ? content : '';
        }
      }
    } catch (_e) {
      // Not valid JSON, continue with cleaning
    }
  }

  // Try to extract JSON from code blocks first
  const jsonCodeBlockMatch = cleaned.match(/```(?:json)?\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*```/);
  if (jsonCodeBlockMatch && jsonCodeBlockMatch[1]) {
    try {
      const jsonText = jsonCodeBlockMatch[1];
      if (jsonText) {
        const parsed = JSON.parse(jsonText);
        const content = extractJsonContent(parsed);
        if (content !== null) {
          return content.trim().length > 0 ? content : '';
        }
      }
    } catch (_e) {
      // Not valid JSON, continue
    }
  }

  // Try to parse entire text as JSON
  try {
    const parsed = JSON.parse(cleaned);
    const content = extractJsonContent(parsed);
    if (content !== null) {
      return content.trim().length > 0 ? content : '';
    }
  } catch (_e) {
    // Not valid JSON, continue with cleaning
  }

  // Remove JSON code blocks if still present
  cleaned = cleaned
    .replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/g, '') // Remove ```json {...} ```
    .replace(/```(?:json)?\s*\[[\s\S]*?\]\s*```/g, '') // Remove ```json [...] ```
    .replace(/```json\s*/g, '') // Remove opening ```json
    .replace(/```\s*/g, '') // Remove closing ```
    .trim();

  // Try to extract JSON object/array from text and parse it
  const jsonMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch && jsonMatch[1]) {
    try {
      const jsonText = jsonMatch[1];
      if (jsonText) {
        const parsed = JSON.parse(jsonText);
        const content = extractJsonContent(parsed);
        if (content !== null) {
          return content.trim().length > 0 ? content : '';
        }
      }
    } catch (_e) {
      // Not valid JSON, continue
    }
  }

  // If cleaned text still looks like JSON (starts with { or [), try to extract text from it
  if (cleaned.startsWith('{') || cleaned.startsWith('[')) {
    try {
      const parsed = JSON.parse(cleaned);
      const content = extractJsonContent(parsed);
      if (content !== null) {
        return content.trim().length > 0 ? content : '';
      }
    } catch (_e) {
      // Not valid JSON, return as-is but log warning
      logger.warn('⚠️ [TextSanitizer] Text looks like JSON but failed to parse, returning as-is');
    }
  }

  return cleaned;

}

/**
 * Banned words for content validation
 */
const BANNED_WORDS = ['hack', 'exploit', 'virus', 'malware'] as const;

/**
 * Validate and sanitize prompt
 * @param prompt - Prompt to validate and sanitize
 * @returns Sanitized prompt
 * @throws ValidationError if prompt is invalid
 */
export function validateAndSanitizePrompt(prompt: unknown): string {
  if (!prompt || typeof prompt !== 'string') {
    const error: ValidationError = {
      message: 'Prompt is required and must be a string',
      code: 'INVALID_PROMPT'
    };
    throw error;
  }

  const sanitized: string = sanitizeText(prompt);

  if (sanitized.length < TEXT_LIMITS.MIN_PROMPT_LENGTH) {
    const error: ValidationError = {
      message: `Prompt must be at least ${TEXT_LIMITS.MIN_PROMPT_LENGTH} characters long`,
      code: 'PROMPT_TOO_SHORT'
    };
    throw error;
  }

  if (sanitized.length > TEXT_LIMITS.MAX_PROMPT_LENGTH) {
    const error: ValidationError = {
      message: `Prompt must be less than ${TEXT_LIMITS.MAX_PROMPT_LENGTH} characters`,
      code: 'PROMPT_TOO_LONG'
    };
    throw error;
  }

  // Check for potentially harmful content
  const lowerPrompt = sanitized.toLowerCase();

  for (const word of BANNED_WORDS) {
    if (lowerPrompt.includes(word)) {
      const error: ValidationError = {
        message: 'Prompt contains inappropriate content',
        code: 'INAPPROPRIATE_CONTENT'
      };
      throw error;
    }
  }

  return sanitized;
}
