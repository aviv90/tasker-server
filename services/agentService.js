const { GoogleGenerativeAI } = require('@google/generative-ai');
const conversationManager = require('./conversationManager');
const geminiService = require('./geminiService');

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

/**
 * Agent Service - Autonomous AI agent that can use tools dynamically
 * 
 * This service allows Gemini to act as an autonomous agent that can:
 * - Fetch chat history when needed
 * - Analyze images/videos/audio from history
 * - Search the web
 * - And more...
 */

/**
 * Define available tools for the agent
 */
const agentTools = {
  // Tool 1: Get chat history
  get_chat_history: {
    declaration: {
      name: 'get_chat_history',
      description: 'קבל את היסטוריית ההודעות מהשיחה. השתמש בכלי הזה כשהמשתמש מתייחס להודעות קודמות, או כשאתה צריך קונטקסט נוסף מהשיחה.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'מספר ההודעות האחרונות לשלוף (ברירת מחדל: 20)',
          }
        },
        required: []
      }
    },
    execute: async (args, context) => {
      const limit = args.limit || 20;
      console.log(`🔧 [Agent Tool] get_chat_history called with limit: ${limit}`);
      
      try {
        const history = await conversationManager.getChatHistory(context.chatId, limit);
        
        if (!history || history.length === 0) {
          return {
            success: true,
            data: 'אין היסטוריית הודעות זמינה',
            messages: []
          };
        }
        
        // Format history for the agent
        const formattedHistory = history.map((msg, idx) => {
          let content = `${msg.role === 'user' ? 'משתמש' : 'בוט'}: ${msg.content}`;
          
          // Add media indicators
          if (msg.metadata) {
            if (msg.metadata.hasImage) content += ' [יש תמונה מצורפת]';
            if (msg.metadata.hasVideo) content += ' [יש וידאו מצורף]';
            if (msg.metadata.hasAudio) content += ' [יש אודיו מצורף]';
            if (msg.metadata.imageUrl) content += ` [image_id: ${idx}]`;
            if (msg.metadata.videoUrl) content += ` [video_id: ${idx}]`;
            if (msg.metadata.audioUrl) content += ` [audio_id: ${idx}]`;
          }
          
          return content;
        }).join('\n');
        
        return {
          success: true,
          data: `היסטוריה של ${history.length} הודעות אחרונות:\n\n${formattedHistory}`,
          messages: history  // Keep full history for follow-up tools
        };
      } catch (error) {
        console.error('❌ Error in get_chat_history tool:', error);
        return {
          success: false,
          error: `שגיאה בשליפת היסטוריה: ${error.message}`
        };
      }
    }
  },

  // Tool 2: Analyze image from history
  analyze_image_from_history: {
    declaration: {
      name: 'analyze_image_from_history',
      description: 'נתח תמונה מהיסטוריית ההודעות. השתמש בכלי הזה אחרי ששלפת את היסטוריית ההודעות וראית שיש תמונה רלוונטית.',
      parameters: {
        type: 'object',
        properties: {
          image_id: {
            type: 'number',
            description: 'מזהה התמונה מההיסטוריה (המספר שמופיע ב-[image_id: X])',
          },
          question: {
            type: 'string',
            description: 'השאלה או הבקשה לגבי התמונה',
          }
        },
        required: ['image_id', 'question']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] analyze_image_from_history called with image_id: ${args.image_id}`);
      
      try {
        // Get the message with the image
        const history = context.previousToolResults?.get_chat_history?.messages;
        if (!history || !history[args.image_id]) {
          return {
            success: false,
            error: `לא נמצאה תמונה עם המזהה ${args.image_id}`
          };
        }
        
        const message = history[args.image_id];
        const imageUrl = message.metadata?.imageUrl;
        
        if (!imageUrl) {
          return {
            success: false,
            error: `ההודעה ${args.image_id} לא מכילה תמונה`
          };
        }
        
        // Download and analyze the image
        const { downloadFile } = require('../utils/fileDownloader');
        const imageBuffer = await downloadFile(imageUrl);
        
        const { analyzeImageWithText } = require('./geminiService');
        const result = await analyzeImageWithText(args.question, imageBuffer);
        
        if (result.success) {
          return {
            success: true,
            data: result.text
          };
        } else {
          return {
            success: false,
            error: result.error || 'שגיאה בניתוח התמונה'
          };
        }
      } catch (error) {
        console.error('❌ Error in analyze_image_from_history tool:', error);
        return {
          success: false,
          error: `שגיאה בניתוח תמונה: ${error.message}`
        };
      }
    }
  },

  // Tool 3: Search web
  search_web: {
    declaration: {
      name: 'search_web',
      description: 'חפש מידע באינטרנט. השתמש בכלי הזה כשאתה צריך מידע עדכני או מידע שאינו זמין בידע שלך.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'שאילתת החיפוש',
          }
        },
        required: ['query']
      }
    },
    execute: async (args, context) => {
      console.log(`🔧 [Agent Tool] search_web called with query: ${args.query}`);
      
      try {
        // Use Gemini with Google Search
        const result = await geminiService.generateTextResponse(args.query, [], {
          useGoogleSearch: true
        });
        
        if (result.error) {
          return {
            success: false,
            error: result.error
          };
        }
        
        return {
          success: true,
          data: result.text
        };
      } catch (error) {
        console.error('❌ Error in search_web tool:', error);
        return {
          success: false,
          error: `שגיאה בחיפוש: ${error.message}`
        };
      }
    }
  }
};

/**
 * Execute an agent query with autonomous tool usage
 * @param {string} prompt - User's question/request
 * @param {string} chatId - Chat ID for context
 * @param {Object} options - Additional options
 * @returns {Object} - Response with text and tool usage info
 */
async function executeAgentQuery(prompt, chatId, options = {}) {
  console.log(`🤖 [Agent] Starting autonomous query: "${prompt.substring(0, 100)}..."`);
  
  const maxIterations = options.maxIterations || 5;  // Prevent infinite loops
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  
  // Prepare tool declarations for Gemini
  const functionDeclarations = Object.values(agentTools).map(tool => tool.declaration);
  
  // System prompt for the agent
  const systemInstruction = `אתה עוזר AI אוטונומי וחכם. יש לך גישה לכלים שיכולים לעזור לך לענות על שאלות.

כללי שימוש בכלים:
1. אם המשתמש שואל שאלה על תוכן השיחה או מתייחס להודעות קודמות - השתמש ב-get_chat_history
2. אם בהיסטוריה יש תמונה רלוונטית לשאלה - השתמש ב-analyze_image_from_history
3. אם אתה צריך מידע עדכני או מידע שאינו זמין לך - השתמש ב-search_web
4. אם אין צורך בכלים - פשוט ענה ישירות

חשוב: תשיב בעברית, באופן טבעי ונעים.`;

  // Context for tool execution
  const context = {
    chatId,
    previousToolResults: {}
  };
  
  // Conversation history for the agent
  const chat = model.startChat({
    history: [],
    tools: [{ functionDeclarations }],
    systemInstruction: systemInstruction
  });
  
  let response = await chat.sendMessage(prompt);
  let iterationCount = 0;
  
  // Agent loop - continue until we get a final text response
  while (iterationCount < maxIterations) {
    iterationCount++;
    console.log(`🔄 [Agent] Iteration ${iterationCount}/${maxIterations}`);
    
    const result = response.response;
    
    // Check if Gemini wants to call a function
    const functionCalls = result.functionCalls();
    
    if (!functionCalls || functionCalls.length === 0) {
      // No more function calls - we have a final answer
      const text = result.text();
      console.log(`✅ [Agent] Completed in ${iterationCount} iterations`);
      
      return {
        success: true,
        text: text,
        toolsUsed: Object.keys(context.previousToolResults),
        iterations: iterationCount
      };
    }
    
    // Execute function calls
    console.log(`🔧 [Agent] Executing ${functionCalls.length} function call(s)`);
    const functionResponses = [];
    
    for (const call of functionCalls) {
      const toolName = call.name;
      const toolArgs = call.args;
      
      console.log(`   → Calling tool: ${toolName} with args:`, toolArgs);
      
      const tool = agentTools[toolName];
      if (!tool) {
        console.error(`❌ Unknown tool: ${toolName}`);
        functionResponses.push({
          name: toolName,
          response: {
            success: false,
            error: `Unknown tool: ${toolName}`
          }
        });
        continue;
      }
      
      // Execute the tool
      const toolResult = await tool.execute(toolArgs, context);
      
      // Save result for future tool calls
      context.previousToolResults[toolName] = toolResult;
      
      functionResponses.push({
        name: toolName,
        response: toolResult
      });
    }
    
    // Send function responses back to Gemini
    response = await chat.sendMessage(functionResponses);
  }
  
  // Max iterations reached
  console.warn(`⚠️ [Agent] Max iterations (${maxIterations}) reached`);
  return {
    success: false,
    error: 'הגעתי למספר המקסימלי של ניסיונות. נסה לנסח את השאלה אחרת.',
    toolsUsed: Object.keys(context.previousToolResults),
    iterations: iterationCount
  };
}

/**
 * Check if a query should use the agent (vs regular routing)
 * @param {string} prompt - User's prompt
 * @param {Object} input - Normalized input
 * @returns {boolean} - True if should use agent
 */
function shouldUseAgent(prompt, input) {
  // Use agent if:
  // 1. Question refers to chat history/previous messages
  // 2. Complex question that might need multiple steps
  // 3. Question about media in the conversation
  
  const historyPatterns = [
    /מה\s+(אמרתי|אמרת|כתבתי|כתבת|שלחתי|שלחת|דיברתי|דיברת)\s+(קודם|לפני|בהודעה|בשיחה)?/i,
    /על\s+מה\s+(דיברנו|עסקנו|שוחחנו)/i,
    /(ב|מ|על)(ה)?(תמונה|וידאו|הקלטה|הודעה|שיחה)\s+(האחרונה|הקודמת|שבהיסטוריה)/i,
    /what\s+(did\s+)?(I|we|you)\s+(say|said|write|wrote|mention|talk|discuss)/i,
    /about\s+the\s+(image|video|audio|message|conversation)/i,
    /in\s+the\s+(previous|last|recent)\s+(message|conversation)/i
  ];
  
  for (const pattern of historyPatterns) {
    if (pattern.test(prompt)) {
      console.log(`🤖 [Agent] Detected history-related query, will use agent`);
      return true;
    }
  }
  
  return false;
}

module.exports = {
  executeAgentQuery,
  shouldUseAgent
};

