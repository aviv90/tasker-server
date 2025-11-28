/**
 * Central Tools Registry - Single Source of Truth
 * ALL tool definitions and descriptions live here
 * Used by: prompts.ts, agentService.ts system instructions
 */

interface ToolParameter {
  type: string;
  required: boolean;
  description: string;
}

interface Tool {
  name: string;
  category: string;
  description: string;
  usage: string[];
  parameters: Record<string, ToolParameter>;
  critical?: string;
}

const TOOLS: Record<string, Tool> = {
  // ═══════════════════ LOCATION & BASIC ═══════════════════
  send_location: {
    name: 'send_location',
    category: 'location',
    description: 'Send random location',
    usage: ['שלח מיקום', 'send location', 'מיקום באזור X'],
    parameters: {
      region: { type: 'string', required: false, description: 'Specific region/city (optional)' }
    }
  },

  // ═══════════════════ CREATION TOOLS ═══════════════════
  create_image: {
    name: 'create_image',
    category: 'creation',
    description: 'Create NEW image with AI. Supports providers: gemini (default), openai, grok. Use this for NEW image requests, even if user specifies provider like "with OpenAI" or "עם Gemini". Do NOT use retry_last_command for new image requests!',
    usage: ['צור תמונה', 'שלח תמונה', 'תמונה של', 'create image', 'send image', 'draw X', 'image of X', 'צור תמונה עם OpenAI', 'create image with Gemini'],
    parameters: {
      prompt: { type: 'string', required: true, description: 'Image description' },
      provider: { type: 'string', required: false, description: 'Image generation provider: gemini (default), openai, grok. If user specifies provider like "with OpenAI" or "עם Gemini", use provider: "openai" or "gemini" accordingly.' }
    },
    critical: 'Use for ANY request to create/send/make an image. "שלח תמונה של X" means CREATE image, not search! If user requests NEW image with provider, use create_image with provider parameter, NOT retry_last_command!'
  },

  create_video: {
    name: 'create_video',
    category: 'creation',
    description: 'Create NEW video with AI. Supports providers: veo3 (Google Veo 3), sora/sora-pro (OpenAI Sora 2), kling (default). Use this for NEW video requests, even if user specifies provider like "with Veo 3". Do NOT use retry_last_command for new video requests!',
    usage: ['צור וידאו', 'create video', 'make video of X', 'צור וידאו עם Veo 3', 'create video with Sora'],
    parameters: {
      prompt: { type: 'string', required: true, description: 'Video description' },
      provider: { type: 'string', required: false, description: 'Video generation provider: veo3 (Google Veo 3 - best quality), sora/sora-pro (OpenAI Sora 2 - cinematic), kling (Replicate Kling - fast, default). If user specifies provider like "with Veo 3", use provider: "veo3".' }
    }
  },

  image_to_video: {
    name: 'image_to_video',
    category: 'creation',
    description: 'Convert/animate image to video (when image is attached). Supports providers: veo3 (Gemini Veo 3), sora/sora-pro (OpenAI Sora 2), kling (default). Use this for NEW image-to-video requests, even if user specifies provider like "with Veo 3". Do NOT use retry_last_command for new image-to-video requests!',
    usage: ['הפוך לווידאו', 'הפוך תמונה לוידאו', 'animate', 'animate image', 'make video from image', 'convert to video', 'הפוך לווידאו עם Veo 3'],
    parameters: {
      image_url: { type: 'string', required: true, description: 'Image URL' },
      prompt: { type: 'string', required: false, description: 'Animation instructions' },
      provider: { type: 'string', required: false, description: 'Image-to-video provider: veo3 (Gemini Veo 3 - best quality), sora/sora-pro (OpenAI Sora 2 - cinematic), kling (Replicate Kling - fast, default). If user specifies provider like "with Veo 3", use provider: "veo3".' }
    },
    critical: 'Use ONLY when user attached an image and wants to animate/convert it to video. NOT for creating new videos! If user requests NEW image-to-video conversion with provider, use image_to_video with provider parameter, NOT retry_last_command!'
  },

  create_music: {
    name: 'create_music',
    category: 'creation',
    description: 'Create NEW song/music with Suno AI (with melody). Use ONLY for "צור שיר" / "create song" / "make music" / "song with melody". Do NOT use for "כתוב שיר" / "write song" (text only - no tool needed).',
    usage: ['צור שיר', 'יצירת שיר', 'שיר עם מנגינה', 'create song', 'make music', 'generate song'],
    parameters: {
      prompt: { type: 'string', required: true, description: 'Song description/lyrics' },
      make_video: { type: 'boolean', required: false, description: 'Also create music video' }
    },
    critical: 'Use ONLY for creating NEW songs. For EXISTING songs, use search_web! If user requests NEW song/music, use create_music, NOT retry_last_command!'
  },

  create_poll: {
    name: 'create_poll',
    category: 'creation',
    description: 'Create WhatsApp poll',
    usage: ['צור סקר', 'create poll'],
    parameters: {
      topic: { type: 'string', required: true, description: 'Poll topic' },
      num_options: { type: 'number', required: false, description: 'Number of options (2-12)' },
      with_rhyme: { type: 'boolean', required: false, description: 'Make options rhyme' }
    }
  },

  create_group: {
    name: 'create_group',
    category: 'creation',
    description: 'Create WhatsApp group with participants. Only available for authorized users.',
    usage: ['צור קבוצה', 'create group', 'צור קבוצה עם המשפחה'],
    parameters: {
      group_name: { type: 'string', required: true, description: 'Group name' },
      participants_description: { type: 'string', required: false, description: 'Participants description (e.g., "all family members", "work team")' }
    }
  },

  // ═══════════════════ ANALYSIS TOOLS ═══════════════════
  analyze_image: {
    name: 'analyze_image',
    category: 'analysis',
    description: 'Analyze/describe image',
    usage: ['מה בתמונה', 'what is in this image', 'תאר את התמונה'],
    parameters: {
      image_url: { type: 'string', required: true, description: 'Image URL to analyze' },
      question: { type: 'string', required: false, description: 'Specific question about image' }
    }
  },

  analyze_image_from_history: {
    name: 'analyze_image_from_history',
    category: 'analysis',
    description: 'Analyze quoted/previous image from chat history',
    usage: ['quoted image + question'],
    parameters: {
      question: { type: 'string', required: true, description: 'Question about the image' }
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
    }
  },

  // ═══════════════════ EDITING TOOLS ═══════════════════
  edit_image: {
    name: 'edit_image',
    category: 'editing',
    description: 'Edit existing image. Supports services: openai (default), gemini. Use this for NEW image editing requests, even if user specifies service like "with OpenAI". Do NOT use retry_last_command for new editing requests!',
    usage: ['ערוך תמונה', 'edit image', 'שנה את התמונה', 'ערוך עם Gemini'],
    parameters: {
      image_url: { type: 'string', required: true, description: 'Image URL to edit' },
      edit_instruction: { type: 'string', required: true, description: 'What to edit' },
      service: { type: 'string', required: false, description: 'Image editing service: openai (default), gemini. If user specifies service like "with Gemini", use service: "gemini".' }
    }
  },

  edit_video: {
    name: 'edit_video',
    category: 'editing',
    description: 'Edit existing video (Runway only)',
    usage: ['ערוך וידאו', 'edit video', 'change video'],
    parameters: {
      video_url: { type: 'string', required: true, description: 'Video URL to edit' },
      edit_instruction: { type: 'string', required: true, description: 'What to edit' }
    },
    critical: 'Use ONLY for editing existing videos. Provider is always Runway (no other providers supported).'
  },

  // ═══════════════════ AUDIO/VOICE TOOLS ═══════════════════
  text_to_speech: {
    name: 'text_to_speech',
    category: 'audio',
    description: 'Convert text to speech (NO translation)',
    usage: ['אמור X', 'say X', 'תקרא בקול'],
    parameters: {
      text: { type: 'string', required: true, description: 'Text to speak' },
      voice: { type: 'string', required: false, description: 'Voice style' }
    },
    critical: 'Use ONLY if user explicitly requests audio ("אמור", "תשמיע", "voice", "say")'
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
    critical: 'Use ONLY when user EXPLICITLY states BOTH text AND target language (e.g., "אמור X בערבית"). Do NOT guess target language! Do NOT use based on previous commands!'
  },

  translate_text: {
    name: 'translate_text',
    category: 'translation',
    description: 'Translate text (NO speech)',
    usage: ['תרגם ל-X', 'translate to X'],
    parameters: {
      text: { type: 'string', required: true, description: 'Text to translate' },
      target_language: { type: 'string', required: true, description: 'Target language' }
    }
  },

  transcribe_audio: {
    name: 'transcribe_audio',
    category: 'audio',
    description: 'Convert speech to text',
    usage: ['תמלל הקלטה', 'transcribe audio'],
    parameters: {
      audio_url: { type: 'string', required: true, description: 'Audio file URL' }
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
    }
  },

  // ═══════════════════ SEARCH & INFO ═══════════════════
  search_web: {
    name: 'search_web',
    category: 'search',
    description: 'Search web for EXISTING content and links using Google Search',
    usage: ['שלח לי לינק', 'find link to X', 'חפש קישור', 'מצא שיר של X', 'קישור ל-X'],
    parameters: {
      query: { type: 'string', required: true, description: 'Search query' }
    },
    critical: 'Use ONLY for finding links/URLs to EXISTING content. NOT for creating new images/videos! "שלח תמונה של X" = create_image, NOT search_web!'
  },

  search_google_drive: {
    name: 'search_google_drive',
    category: 'search',
    description: 'Search and retrieve documents, images, and files from Google Drive. Can extract text from documents and images for RAG-like functionality.',
    usage: ['חפש ב-Google Drive', 'חפש במסמכים', 'מה יש בתיקייה X', 'מצא מידע על Y ב-Drive', 'search in drive', 'find document about X', 'מה כתוב במסמך Y', 'מה יש בשרטוט', 'מה מופיע במסמך', 'תסביר את התכנית', 'מה כתוב בקובץ'],
    parameters: {
      query: { type: 'string', required: true, description: 'Search query for files and content' },
      folder_id: { type: 'string', required: false, description: 'Specific folder ID to search in (optional)' },
      max_results: { type: 'number', required: false, description: 'Maximum number of files to return (default: 5)' }
    },
    critical: 'CRITICAL: ALWAYS use search_google_drive for questions about drawings/documents/files (e.g., "מה יש בשרטוט", "מה מופיע במסמך", "תסביר את התכנית"). Do NOT use get_chat_history or analyze_image_from_history for Drive files! Use ONLY for searching and retrieving information from Google Drive. NOT for web search (use search_web) or creating new content!'
  },

  get_chat_history: {
    name: 'get_chat_history',
    category: 'context',
    description: 'Retrieve conversation history. Use when user asks about chat/group information, previous messages, or any information related to the conversation.',
    usage: ['מה אמרתי קודם', 'מתי כל חבר יכול להיפגש', 'מה דיברנו על X', 'מי אמר Y', 'מתי נקבעה הפגישה', 'what did I say earlier', 'when can everyone meet'],
    parameters: {
      limit: { type: 'number', required: false, description: 'Number of messages (default: 20)' }
    },
    critical: 'ALWAYS use get_chat_history when user asks about chat/group/conversation information. NEVER say "I don\'t have access" - use this tool first! CRITICAL: Do NOT use for questions about drawings/documents/files in Google Drive (e.g., "מה יש בשרטוט", "מה מופיע במסמך") - use search_google_drive instead!'
  },

  get_long_term_memory: {
    name: 'get_long_term_memory',
    category: 'context',
    description: 'Access user preferences and conversation summaries',
    usage: ['מה אני אוהב', 'what do I prefer'],
    parameters: {
      include_summaries: { type: 'boolean', required: false, description: 'Include summaries (default: true)' },
      include_preferences: { type: 'boolean', required: false, description: 'Include preferences (default: true)' }
    }
  },

  save_user_preference: {
    name: 'save_user_preference',
    category: 'context',
    description: 'Save user preference for future reference',
    usage: ['תזכור ש...', 'remember that...'],
    parameters: {
      preference_key: { type: 'string', required: true, description: 'Preference key (e.g., favorite_color)' },
      preference_value: { type: 'string', required: true, description: 'Preference value' }
    }
  },

  chat_summary: {
    name: 'chat_summary',
    category: 'context',
    description: 'Summarize recent conversation',
    usage: ['סכם את השיחה', 'summarize our chat'],
    parameters: {
      num_messages: { type: 'number', required: false, description: 'Messages to summarize (default: 20)' }
    }
  },

  // ═══════════════════ META-TOOLS (Advanced) ═══════════════════
  retry_last_command: {
    name: 'retry_last_command',
    category: 'meta',
    description: 'Retry last command with optional modifications',
    usage: ['נסה שוב', 'try again', '# שוב אבל...'],
    parameters: {
      modifications: { type: 'string', required: false, description: 'Changes to apply' }
    }
  },

  retry_with_different_provider: {
    name: 'retry_with_different_provider',
    category: 'meta',
    description: 'Retry failed task with different AI provider',
    usage: ['Internal - called when tool fails'],
    parameters: {
      original_tool: { type: 'string', required: true, description: 'Tool that failed' },
      task_type: { type: 'string', required: true, description: 'Task type (image/video/music)' }
    }
  },

  smart_execute_with_fallback: {
    name: 'smart_execute_with_fallback',
    category: 'meta',
    description: 'Execute with automatic fallback on failure',
    usage: ['Internal - resilient execution'],
    parameters: {}
  }
};

/**
 * Get tools by category
 */
export function getToolsByCategory(category: string): Tool[] {
  return Object.values(TOOLS).filter(tool => tool.category === category);
}

/**
 * Get user-facing tools (exclude meta-tools)
 */
export function getUserFacingTools(): Tool[] {
  return Object.values(TOOLS).filter(tool => tool.category !== 'meta');
}

/**
 * Get tools for multi-step planner (most relevant)
 */
export function getPlannerTools(): Tool[] {
  const categories = ['location', 'creation', 'audio', 'search', 'context', 'analysis', 'editing'];
  return Object.values(TOOLS).filter(tool => categories.includes(tool.category));
}

/**
 * Format tools list for prompts
 */
export function formatToolsForPrompt(tools: Tool[] = getUserFacingTools()): string {
  return tools.map(tool => {
    const params = Object.keys(tool.parameters || {})
      .map(key => {
        const param = tool.parameters[key];
        if (!param) return '';
        return `${key}${param.required ? '' : '?'}:${param.type}`;
      })
      .filter(Boolean)
      .join(', ');
    
    return `• ${tool.name}(${params}) - ${tool.description}`;
  }).join('\n');
}

/**
 * Format compact tools list (name + description only)
 */
export function formatToolsCompact(tools: Tool[] = getUserFacingTools()): string {
  return tools.map(tool => `• ${tool.name} - ${tool.description}`).join('\n');
}

/**
 * Get critical rules for specific tools
 */
export function getCriticalRules(): string {
  return Object.values(TOOLS)
    .filter(tool => tool.critical)
    .map(tool => `• ${tool.name}: ${tool.critical}`)
    .join('\n');
}

export { TOOLS };
export type { Tool, ToolParameter };

