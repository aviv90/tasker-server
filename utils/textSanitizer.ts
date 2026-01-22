/**
 * Text sanitization utilities for safe AI generation
 */

import { TEXT_LIMITS } from './constants';
import logger from './logger';

// Pre-compiled regexes for performance
const CONTROL_CHARS_REGEX = /[\x00-\x08\x0E-\x1F\x7F]/g;
const WHITESPACE_REGEX = /\s+/g;
const MARKDOWN_CODE_BLOCK_REGEX = /```[\s\S]*?```/g;
const MARKDOWN_INLINE_CODE_REGEX = /`[^`]*`/g;
const MULTI_WHITESPACE_REGEX = /\s{2,}/g;

// Media cleaning regexes
const URL_REGEX = /https?:\/\/[^\s]+/gi;
const MD_LINK_REGEX = /\[.*?\]\(https?:\/\/[^)]+\)/g;
const GENERIC_TAGS_REGEX = /\[(image|video|audio|תמונה|וידאו|אודיו|Media)\]/gi;
const TAG_WITH_ID_REGEX = /\[(image|video|audio|imageUrl|videoUrl|audioUrl|image_url|video_url|audio_url|image_id|video_id|audio_id)(:|=)\s*[^\]]*\]?/gi;
const BRACE_TAG_REGEX = /\{(imageUrl|videoUrl|audioUrl|taskId)(:|=)\s*[^}]*\}?/gi;
const STATUS_TAGS_REGEX = /\[(Image|Video|Audio|Voice message)\s+(sent|created)\]/gi;
const LINK_PLACEHOLDERS_REGEX = /\[(Video|Audio|Image|Music|File|Link|קישור|לינק)[^\]]*\]/gi;
const TOOL_RESULT_REGEX = /(audioUrl|imageUrl|videoUrl|image_url|video_url|audio_url):\s*https?:\/\/[^\s\]]+/gi;
const TASK_ID_LEAK_REGEX = /taskId:\s*["']?[a-f0-9-]+["']?/gi;
const TRUNCATED_KEYS_REGEX = /\{(imageUrl|videoUrl|audioUrl|taskId):\s*["']?$/gi;
const HEBREW_IMAGE_TAG_REGEX = /\[תמונה:\s*image_id=[^\]]*\]|\[וידאו:\s*video_id=[^\]]*\]|\[אודיו:\s*audio_id=[^\]]*\]/gi;

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
    .replace(CONTROL_CHARS_REGEX, '') // Remove control characters (but preserve emojis)
    .replace(WHITESPACE_REGEX, ' ') // Normalize whitespace
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
    .replace(MARKDOWN_CODE_BLOCK_REGEX, '') // Remove code blocks
    .replace(MARKDOWN_INLINE_CODE_REGEX, '') // Remove inline code
    .replace(/^\s*```+\s*$/gm, '')
    .replace(/^\s*```+\s*/gm, '')
    .replace(/\s*```+\s*$/gm, '')
    .replace(/^\s*`+\s*$/gm, '')
    .replace(/^\s*`+\s*/gm, '')
    .replace(/\s*`+\s*$/gm, '')
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

  // Step 1: Clean markdown and URLs
  let cleaned = cleanMarkdown(text);

  if (!preserveLinks) {
    cleaned = cleaned
      .replace(MD_LINK_REGEX, '')
      .replace(URL_REGEX, '');
  }

  cleaned = cleaned
    .replace(GENERIC_TAGS_REGEX, '')
    .replace(TAG_WITH_ID_REGEX, '')
    .replace(BRACE_TAG_REGEX, '')
    .replace(STATUS_TAGS_REGEX, '')
    .replace(LINK_PLACEHOLDERS_REGEX, '')
    .replace(TOOL_RESULT_REGEX, '')
    .replace(TASK_ID_LEAK_REGEX, '')
    .replace(HEBREW_IMAGE_TAG_REGEX, '')
    .replace(TRUNCATED_KEYS_REGEX, '')
    .replace(/תמונה:\s*$/gi, '')
    .replace(/✅/g, '')
    .replace(/[[]]/g, '')
    .replace(/[.)},;:-]+$/g, '')
    .replace(/^[,.)},;:-]+/g, '');

  // Step 2: Clean up whitespace
  cleaned = cleaned
    .replace(MULTI_WHITESPACE_REGEX, ' ')
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

  return text
    .replace(URL_REGEX, '')
    .replace(GENERIC_TAGS_REGEX, '')
    .replace(TAG_WITH_ID_REGEX, '')
    .replace(BRACE_TAG_REGEX, '')
    .replace(STATUS_TAGS_REGEX, '')
    .replace(LINK_PLACEHOLDERS_REGEX, '')
    .replace(TOOL_RESULT_REGEX, '')
    .replace(TASK_ID_LEAK_REGEX, '')
    .replace(HEBREW_IMAGE_TAG_REGEX, '')
    .replace(TRUNCATED_KEYS_REGEX, '')
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
const JSON_CONTENT_FIELDS = ['answer', 'text', 'message', 'content', 'description', 'data', 'formatted_address', 'address'] as const;

/**
 * Extract content from parsed JSON object
 * Handles arrays, nested objects (like Google Maps results), and simple objects
 * @param parsed - Parsed JSON object
 * @returns Extracted content string or null
 */
function extractJsonContent(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
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

  // CRITICAL: If the entire text is a JSON object/array, try to extract meaningful content
  // This handles cases where Gemini returns raw JSON instead of text
  const jsonObjectMatch = cleaned.match(/^[\s\n]*(\{[\s\S]*\}|\[[\s\S]*\])[\s\n]*$/);
  if (jsonObjectMatch && jsonObjectMatch[1]) {
    try {
      const jsonText = jsonObjectMatch[1];
      if (jsonText) {
        const parsed = JSON.parse(jsonText);
        const content = extractJsonContent(parsed);
        if (content !== null && content.trim().length > 0) {
          return content;
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
        if (content !== null && content.trim().length > 0) {
          return content;
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
    if (content !== null && content.trim().length > 0) {
      return content;
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
        if (content !== null && content.trim().length > 0) {
          return content;
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
      if (content !== null && content.trim().length > 0) {
        return content;
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
