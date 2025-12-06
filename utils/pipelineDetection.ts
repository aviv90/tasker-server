/**
 * Pipeline Detection Utilities
 * Detects when tool results are part of a pipeline (data tools → output tools)
 * and should be suppressed to avoid sending intermediate results to users
 */

import logger from './logger';

/**
 * Map of data tools - tools that return intermediate data used by other tools
 * These tools' output should be suppressed when used in a pipeline
 */
export const DATA_TOOLS = [
  'get_chat_history',
  'chat_summary',
  'search_web',
  'search_google_drive',
  'translate_text',
  'get_long_term_memory',
  'analyze_image_from_history',
  'transcribe_audio'
] as const;

/**
 * Map of output tools - tools that create final output (media, polls, locations, etc.)
 * These are the final tools in a pipeline whose output should be sent
 */
export const OUTPUT_TOOLS = [
  'create_image',
  'create_video',
  'image_to_video',
  'animate_image',
  'create_poll',
  'send_location',
  'create_music',
  'text_to_speech',
  'translate_and_speak',
  'voice_clone_and_speak',
  'creative_audio_mix'
] as const;

/**
 * Check if user requested two separate commands (not a pipeline)
 * Examples: "שלח תמונה ואז שלח סקר" / "send image and then send poll"
 * @param userText - User's text input
 * @returns True if user requested two separate commands
 */
export function isTwoSeparateCommands(userText: string): boolean {
  // Patterns that indicate two separate commands
  const separateCommandPatterns = [
    /(?:ואז|אחר כך|אחרי זה|and then|after that|and also|וגם)\s+(?:שלח|צור|create|send|make)/i,
    /(?:שלח|צור|create|send|make).*?(?:ואז|אחר כך|אחרי זה|and then|after that).*?(?:שלח|צור|create|send|make)/i,
    /(?:תמונה|image).*?(?:ואז|אחר כך|and then).*?(?:סקר|poll|מיקום|location)/i,
    /(?:סקר|poll).*?(?:ואז|אחר כך|and then).*?(?:תמונה|image|מיקום|location)/i
  ];

  return separateCommandPatterns.some(pattern => pattern.test(userText));
}

/**
 * Get the last output tool in the pipeline (the final tool whose output should be sent)
 * @param toolsUsed - List of tools used
 * @returns The last output tool, or null if none found
 */
export function getLastOutputTool(toolsUsed: string[]): string | null {
  // Find the last output tool in the sequence
  for (let i = toolsUsed.length - 1; i >= 0; i--) {
    const tool = toolsUsed[i];
    if (tool && OUTPUT_TOOLS.includes(tool as typeof OUTPUT_TOOLS[number])) {
      return tool;
    }
  }
  return null;
}

/**
 * Check if text looks like output from a data tool
 * @param text - Text to check
 * @param dataToolsUsed - List of data tools that were used
 * @returns True if text looks like data tool output
 */
export function looksLikeDataToolOutput(text: string, dataToolsUsed: string[]): boolean {
  // Early return if no tools or empty text
  if (dataToolsUsed.length === 0 || !text || text.trim().length === 0) {
    return false;
  }

  // Patterns that indicate data tool output (compiled once, reused)
  const dataToolPatterns: Record<string, RegExp[]> = {
    'get_chat_history': [
      /(?:היסטוריית|היסטוריה|הודעות|שיחה|conversation|history|messages|הודעה|message)/i,
      /(?:\[message|\[הודעה)/i
    ],
    'chat_summary': [
      /(?:סיכום|summary|תקציר)/i,
      /(?:נושאים|topics|key points)/i
    ],
    'search_web': [
      /(?:תוצאות|results|קישורים|links|found)/i,
      /https?:\/\//i
    ],
    'search_google_drive': [
      /(?:מצאתי|found|נמצא|located)/i,
      /(?:ב-Google Drive|in drive)/i
    ],
    'translate_text': [
      /(?:תרגום|translation|תרגמתי|translated)/i
    ],
    'get_long_term_memory': [
      /(?:העדפות|preferences|סיכומים|summaries)/i
    ]
  };

  // Check if any data tool pattern matches (early return on first match)
  for (const tool of dataToolsUsed) {
    const patterns = dataToolPatterns[tool];
    if (patterns) {
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          return true;
        }
      }
    }
  }

  // Generic patterns for data output (only check if text is long enough)
  if (text.length > 100) {
    const genericDataPatterns = [
      /(?:\[|\]|הודעות|messages|תוצאות|results|קישורים|links)/i,
      /(?:https?:\/\/|www\.)/i,
      /(?:מצאתי|found|נמצא|located|תוצאות|results)/i
    ];

    // Early return on first match
    for (const pattern of genericDataPatterns) {
      if (pattern.test(text)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Interface for tool result that might be part of a pipeline
 */
export interface PipelineCheckResult {
  text?: string | null;
  toolsUsed?: string[];
  imageUrl?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  poll?: unknown;
  latitude?: number | string | null;
  longitude?: number | string | null;
}

/**
 * Check if text is intermediate result from a tool pipeline
 * A pipeline is when data tools (or intermediate output tools) are used to feed into final output tools
 * Examples:
 * - get_chat_history → create_image (data → output)
 * - get_chat_history → chat_summary → create_poll (data → data → output)
 * - create_image → image_to_video (output → output)
 * @param result - Tool result to check
 * @param userText - User's original text input
 * @returns True if text should be suppressed because it's intermediate tool output in a pipeline
 */
export function isIntermediateToolOutputInPipeline(result: PipelineCheckResult, userText: string): boolean {
  const toolsUsed = result.toolsUsed || [];

  // Early return: If no tools were used, this is not a pipeline
  if (toolsUsed.length === 0) {
    return false;
  }

  // Early return: Check if user requested two separate commands (not a pipeline)
  if (isTwoSeparateCommands(userText)) {
    logger.debug(`📝 [Pipeline] User requested two separate commands - not suppressing intermediate output`);
    return false;
  }

  // Early return: Check if final output was created (media, poll, location, etc.)
  const hasFinalOutput = !!result.imageUrl ||
    !!result.videoUrl ||
    !!result.audioUrl ||
    !!result.poll ||
    (!!result.latitude && !!result.longitude);

  if (!hasFinalOutput) {
    return false;
  }

  // Get the last output tool (the final tool in the pipeline)
  const lastOutputTool = getLastOutputTool(toolsUsed);
  if (!lastOutputTool) {
    return false;
  }

  // Identify data tools used (everything except the last output tool)
  // Use Set for O(1) lookup instead of array includes
  const dataToolsSet = new Set(DATA_TOOLS);
  const outputToolsSet = new Set(OUTPUT_TOOLS);

  const dataToolsUsed: string[] = [];
  const intermediateOutputTools: string[] = [];

  for (const tool of toolsUsed) {
    if (tool === lastOutputTool) continue;
    if (dataToolsSet.has(tool as typeof DATA_TOOLS[number])) {
      dataToolsUsed.push(tool);
    } else if (outputToolsSet.has(tool as typeof OUTPUT_TOOLS[number])) {
      intermediateOutputTools.push(tool);
    }
  }

  // Early return: If no intermediate tools (data or output), this is not a pipeline
  if (dataToolsUsed.length === 0 && intermediateOutputTools.length === 0) {
    return false;
  }

  // Check if text looks like intermediate tool output
  const text = result.text || '';
  if (!text.trim()) {
    return false;
  }

  // Check if text looks like data tool output (most common case)
  if (dataToolsUsed.length > 0 && looksLikeDataToolOutput(text, dataToolsUsed)) {
    logger.debug(`⏭️ [Pipeline] Suppressing intermediate data tool output: ${dataToolsUsed.join(', ')} → ${lastOutputTool}`);
    return true;
  }

  // Check if text looks like intermediate output tool result
  // For example, if create_image was used and then image_to_video, we should suppress the image description
  if (intermediateOutputTools.length > 0) {
    // Check if text contains patterns that suggest it's from an intermediate output tool
    const intermediatePatterns = [
      /(?:תמונה נוצרה|image created|תמונה של|image of)/i,
      /(?:✅.*תמונה|✅.*image)/i
    ];

    // Early return on first match
    for (const pattern of intermediatePatterns) {
      if (pattern.test(text)) {
        logger.debug(`⏭️ [Pipeline] Suppressing intermediate output tool result: ${intermediateOutputTools.join(', ')} → ${lastOutputTool}`);
        return true;
      }
    }
  }

  return false;
}

