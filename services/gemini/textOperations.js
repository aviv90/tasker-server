/**
 * Gemini Text Operations
 * 
 * Text generation, chat, translation, and summarization.
 * Extracted from gemini/core.js (Phase 4.5)
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getGeminiErrorMessage, cleanThinkingPatterns } = require('./utils');
const { sanitizeText } = require('../../utils/textSanitizer');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generateTextResponse(prompt, conversationHistory = [], options = {}) {
    try {
        console.log('💬 Gemini text generation');
        
        // Sanitize prompt
        const cleanPrompt = sanitizeText(prompt);
        
        // Check if Google Search should be enabled
        const useGoogleSearch = options.useGoogleSearch === true;
        if (useGoogleSearch) {
            console.log('🔍 Google Search enabled for this request');
        }
        
        const model = genAI.getGenerativeModel({ 
            model: options.model || "gemini-2.5-flash" 
        });

        // Build conversation contents for Gemini
        const contents = [];

        // Build system prompt - optimized but detailed for Google Search
        let systemPrompt = `אתה עוזר AI ידידותי. תן תשובות ישירות וטבעיות.

כללי תשובה:
• תשיב ישירות בלבד - ללא הסברים על תהליך החשיבה
• אסור: "As an AI", "My thought process", "Let's break down", "translates to", "I should"
• תמיד תשיב באותה שפה שבה המשתמש שואל`;

        // Add Google Search specific instructions - MUST BE DETAILED
        if (useGoogleSearch) {
            systemPrompt += `

🔍 **כלי Google Search מופעל עבורך - חובה להשתמש בו!**

**הוראות קריטיות:**
1. ✅ יש לך גישה לכלי Google Search - **השתמש בו לכל בקשת קישור!**
2. ❌ **אסור מוחלט** לענות מהזיכרון שלך (אימון 2023) - הקישורים ישנים ושבורים
3. ❌ **אסור להמציא קישורים** - אם Google Search לא מצא, תגיד "לא מצאתי קישור זמין"
4. ⚠️ הזיכרון שלך מ-2023 - קישורי YouTube/חדשות/אתרים כבר לא עובדים!

**תהליך נכון (חובה!):**
משתמש מבקש קישור → השתמש בכלי Google Search → העתק קישור מהתוצאות → שלח למשתמש

**דוגמה למה שאסור:**
❌ "אין לי אפשרות לשלוח קישורים" - **שקר! יש לך Google Search!**
❌ "הנה קישור: youtube.com/watch?v=abc123" - **מומצא! חפש ב-Google Search!**

**דוגמה נכונה:**
✅ [משתמש ב-Google Search tool] → "הנה קישור מאתר ynet: [קישור אמיתי מהחיפוש]"
✅ אם החיפוש לא הצליח: "לא מצאתי קישור זמין, נסה לחפש ב-Google בעצמך"`;
        }

        // Add system prompt as first user message (Gemini format)
        contents.push({
            role: 'user',
            parts: [{ text: systemPrompt }]
        });
        
        // Add system prompt response
        let modelResponse = 'הבנתי. אשיב ישירות ללא תהליך חשיבה.';
        
        if (useGoogleSearch) {
            modelResponse += ' **כלי Google Search זמין לי ואני חייב להשתמש בו לכל בקשת קישור.** אסור לי לענות מהזיכרון (2023) או להמציא קישורים. אם החיפוש לא מצא תוצאות - אודיע "לא מצאתי קישור זמין".';
        }
        
        contents.push({
            role: 'model',
            parts: [{ text: modelResponse }]
        });
        
        // Add example of Google Search usage ONLY when Google Search is enabled
        // This helps Gemini understand it MUST use the tool
        if (useGoogleSearch) {
            contents.push({
                role: 'user',
                parts: [{ text: 'שלח לי קישור למזג האוויר בתל אביב' }]
            });
            contents.push({
                role: 'model',
                parts: [{ text: '[משתמש בכלי Google Search לחיפוש "מזג אוויר תל אביב"]\n\nהנה קישור לתחזית מזג האוויר בתל אביב: https://www.ims.gov.il/he/cities/2423' }]
            });
        }

        // Normalize conversation history to an array to avoid undefined lengths
        if (!Array.isArray(conversationHistory)) {
            conversationHistory = [];
        }

        // Add conversation history if exists
        if (conversationHistory.length > 0) {
            console.log(`🧠 Using conversation history: ${conversationHistory.length} previous messages`);
            
            for (const msg of conversationHistory) {
                // Convert OpenAI format to Gemini format
                const role = msg.role === 'assistant' ? 'model' : 'user';
                contents.push({
                    role: role,
                    parts: [{ text: msg.content }]
                });
            }
        }

        // Add current user message
        contents.push({
            role: 'user',
            parts: [{ text: cleanPrompt }]
        });

        console.log(`🔮 Gemini processing (${Array.isArray(conversationHistory) ? conversationHistory.length : 0} context messages)`);

        // Build generation config
        // Lower temperature for Google Search to get more deterministic/factual responses
        const generateConfig = {
            contents,
            generationConfig: {
                temperature: useGoogleSearch ? 0.3 : 0.7,
                topP: 0.95,
                topK: 40,
                maxOutputTokens: 2048
            }
        };
        
        // Add Google Search tool if requested
        if (useGoogleSearch) {
            generateConfig.tools = [{
                googleSearch: {}
            }];
            console.log('🔍 Google Search tool enabled');
        }
        
        // Generate response with history (and optionally Google Search)
        const result = await model.generateContent(generateConfig);
        const response = result.response;
        
        // Log if Google Search was actually used and extract grounding metadata
        let groundingMetadata = null;
        if (useGoogleSearch) {
            groundingMetadata = response.candidates?.[0]?.groundingMetadata;
            const searchQueries = response.candidates?.[0]?.groundingMetadata?.searchEntryPoint?.renderedContent;
            
            if (groundingMetadata) {
                console.log('✅ Google Search was used by Gemini');
                const chunksCount = groundingMetadata.groundingChunks?.length || 0;
                console.log(`🔍 Found ${chunksCount} grounding chunks`);
                
                if (searchQueries) {
                    console.log('🔎 Search query executed');
                }
            } else {
                console.warn('⚠️ WARNING: Google Search tool was enabled but Gemini did NOT use it!');
                console.warn('   Gemini likely answered from its training data (2023) instead of searching.');
                console.warn('   User may receive old/broken links.');
            }
        }
        
        if (!response.candidates || response.candidates.length === 0) {
            console.log('❌ Gemini: No candidates returned');
            const errorMsg = getGeminiErrorMessage(null, response.promptFeedback);
            return { error: errorMsg };
        }
        
        let text = response.text();
        
        if (!text || text.trim().length === 0) {
            console.log('❌ Gemini: Empty text response');
            return { error: 'Empty response from Gemini' };
        }
        
        // Clean up verbose thinking patterns that sometimes appear
        text = text.trim();
        
        // Remove meta-linguistic reasoning and English thinking patterns
        // Sometimes Gemini ignores the system prompt and adds reasoning anyway
        text = cleanThinkingPatterns(text);
        
        // CRITICAL FIX: Resolve redirect URLs to get actual destinations
        // Google Search grounding returns vertexaisearch redirect URLs, not real URLs
        if (useGoogleSearch && groundingMetadata?.groundingChunks?.length > 0) {
            console.log('🔗 Processing grounding metadata...');
            
            // Extract redirect URLs from groundingMetadata
            const redirectUrls = groundingMetadata.groundingChunks
                .filter(chunk => chunk.web?.uri)
                .map(chunk => ({
                    redirectUrl: chunk.web.uri,
                    title: chunk.web.title || null
                }));
            
            if (redirectUrls.length > 0) {
                console.log(`🔄 Found ${redirectUrls.length} redirect URLs, resolving to real URLs...`);
                
                // Resolve redirects to get actual URLs using native https module
                const https = require('https');
                const http = require('http');
                const { URL } = require('url');
                
                const realUrls = await Promise.all(
                    redirectUrls.map(async (urlData) => {
                        return new Promise((resolve) => {
                            try {
                                const parsedUrl = new URL(urlData.redirectUrl);
                                const httpModule = parsedUrl.protocol === 'https:' ? https : http;
                                
                                const options = {
                                    method: 'HEAD',
                                    timeout: 5000,
                                    // Don't follow redirects automatically
                                    maxRedirects: 0
                                };
                                
                                let currentUrl = urlData.redirectUrl;
                                let redirectCount = 0;
                                const maxRedirects = 5;
                                
                                const followRedirect = (url) => {
                                    if (redirectCount >= maxRedirects) {
                                        console.log(`✅ Resolved (max redirects): ${urlData.title} → ${currentUrl.substring(0, 80)}...`);
                                        resolve({
                                            uri: currentUrl,
                                            title: urlData.title
                                        });
                                        return;
                                    }
                                    
                                    const parsed = new URL(url);
                                    const module = parsed.protocol === 'https:' ? https : http;
                                    
                                    const req = module.request(url, options, (res) => {
                                        // Check if redirect
                                        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                                            redirectCount++;
                                            // Handle relative redirects
                                            const newUrl = res.headers.location.startsWith('http') 
                                                ? res.headers.location 
                                                : new URL(res.headers.location, url).href;
                                            currentUrl = newUrl;
                                            followRedirect(newUrl);
                                        } else {
                                            // Final destination
                                            console.log(`✅ Resolved: ${urlData.title} → ${currentUrl.substring(0, 80)}...`);
                                            resolve({
                                                uri: currentUrl,
                                                title: urlData.title
                                            });
                                        }
                                    });
                                    
                                    req.on('error', (error) => {
                                        console.warn(`⚠️ Failed to resolve redirect for ${urlData.title}: ${error.message}`);
                                        console.log(`🔗 Using original redirect URL as fallback: ${urlData.redirectUrl.substring(0, 80)}...`);
                                        resolve({
                                            uri: urlData.redirectUrl,
                                            title: urlData.title
                                        });
                                    });
                                    
                                    req.on('timeout', () => {
                                        req.destroy();
                                        console.warn(`⚠️ Timeout resolving redirect for ${urlData.title}`);
                                        console.log(`🔗 Using original redirect URL as fallback: ${urlData.redirectUrl.substring(0, 80)}...`);
                                        resolve({
                                            uri: urlData.redirectUrl,
                                            title: urlData.title
                                        });
                                    });
                                    
                                    req.end();
                                };
                                
                                followRedirect(currentUrl);
                            } catch (error) {
                                console.warn(`⚠️ Error resolving redirect for ${urlData.title}: ${error.message}`);
                                console.log(`🔗 Using original redirect URL as fallback: ${urlData.redirectUrl.substring(0, 80)}...`);
                                resolve({
                                    uri: urlData.redirectUrl,
                                    title: urlData.title
                                });
                            }
                        });
                    })
                );
                
                // Remove any hallucinated URLs from Gemini's text
                // Gemini sometimes generates fake YouTube URLs or other links
                const urlRegex = /(https?:\/\/[^\s)<]+)/g;
                const foundUrls = text.match(urlRegex) || [];
                
                if (foundUrls.length > 0) {
                    console.log(`🔍 Found ${foundUrls.length} URLs in text, removing hallucinated ones...`);
                    
                    // Remove URLs that are likely hallucinated (not from grounding)
                    text = text.replace(urlRegex, '');
                    text = text.replace(/\s+/g, ' ').trim();
                }
                
                // Append resolved URLs directly (without "מקורות:" header to avoid duplication)
                // Gemini already includes links in the text via grounding
                const sourcesText = realUrls
                    .map((urlData) => urlData.uri)
                    .join('\n');
                
                text = `${text}\n${sourcesText}`;
                console.log(`✅ Appended ${realUrls.length} resolved URLs`);
            }
        }
        
        // Fix URLs with parentheses - Gemini sometimes wraps URLs in parentheses
        // or uses Markdown link syntax [text](url)
        // Example: "הנה השיר (https://youtube.com/...)" becomes broken in WhatsApp
        
        // 1. Convert Markdown links [text](url) to plain text with URL
        text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '$1: $2');
        
        // 2. Add space between URL and closing parenthesis to prevent WhatsApp from including ) in URL
        text = text.replace(/(\bhttps?:\/\/[^\s)]+)\)/g, '$1 )');
        
        // 3. Add space between opening parenthesis and URL
        text = text.replace(/\((\bhttps?:\/\/[^\s)]+)/g, '( $1');
        
        // 4. Detect suspicious YouTube URLs (likely hallucinated)
        // YouTube video IDs are exactly 11 characters (alphanumeric, -, _)
        // If we find a YouTube URL with a suspicious ID, log a warning
        if (useGoogleSearch) {
            const youtubeUrls = text.match(/https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([^\s&)]+)/g);
            if (youtubeUrls) {
                youtubeUrls.forEach(url => {
                    const videoIdMatch = url.match(/(?:watch\?v=|youtu\.be\/)([^\s&)]+)/);
                    if (videoIdMatch && videoIdMatch[1]) {
                        const videoId = videoIdMatch[1];
                        // YouTube video IDs should be 11 characters
                        if (videoId.length < 10 || videoId.length > 12) {
                            console.warn(`⚠️ Suspicious YouTube URL detected (ID length: ${videoId.length}): ${url}`);
                            console.warn(`   This URL might be hallucinated by Gemini!`);
                        }
                        // Check for obvious hallucination patterns (e.g., "abc123", "example", "xxx")
                        if (/^(abc|test|example|xxx|demo|sample)/i.test(videoId)) {
                            console.warn(`⚠️ Likely hallucinated YouTube URL detected: ${url}`);
                            console.warn(`   Video ID "${videoId}" looks fake!`);
                        }
                    }
                });
            }
        }
        
        // Detect various thinking/reasoning patterns that should be removed
        const hasThinkingPattern = 
            text.includes('SPECIAL INSTRUCTION:') || 
            text.includes('Think step-by-step') ||
            text.startsWith('THOUGHT') ||
            /^THOUGHT\s/m.test(text) || // THOUGHT at start of a line
            text.includes('*Drafting the response:*') ||
            text.includes('This response:') ||
            text.includes('As an AI, I should:') ||
            text.includes('My response should:') ||
            text.includes('Let\'s break down') ||
            text.includes('The user is essentially asking') ||
            (text.includes('translates to') && text.includes('In the context of')) ||
            text.startsWith('If I were to') || // Chain of thought reasoning
            (text.includes('However, as an AI') || text.includes('However, from a technical perspective')) ||
            text.includes('Let\'s consider the implications') ||
            text.includes('Given the instructions to be');
        
        if (hasThinkingPattern) {
            console.log('🧹 Detected verbose thinking pattern, extracting final answer...');
            
            // Split by common delimiters that separate thinking from final answer
            let finalAnswer = '';
            
            // Try to find the actual answer after thinking patterns
            // Often the final answer comes after patterns like:
            // - "This response:" followed by bullet points, then the actual text
            // - Just after markdown formatting like "*text*" or numbered lists
            
            const lines = text.split('\n');
            let inThinkingSection = false;
            let answerLines = [];
            let foundAnswerStart = false;
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                
                // Skip empty lines at the start
                if (!foundAnswerStart && !line) continue;
                
                // Detect thinking section markers
                if (line.startsWith('THOUGHT') || 
                    line.includes('SPECIAL INSTRUCTION') ||
                    line.includes('Think step-by-step') ||
                    line.includes('I need to:') ||
                    line.includes('*Drafting the response:*') ||
                    line.includes('This response:') ||
                    line.includes('As an AI, I should:') ||
                    line.includes('My response should:') ||
                    line.includes('The user is essentially asking') ||
                    line.includes('translates to') ||
                    line.includes('Let\'s break down') ||
                    line.includes('In the context of') ||
                    line.startsWith('If I were to') ||
                    line.includes('However, as an AI') ||
                    line.includes('However, from a technical perspective') ||
                    line.includes('Let\'s consider the implications') ||
                    line.includes('Given the instructions')) {
                    inThinkingSection = true;
                    continue;
                }
                
                // Skip lines that look like internal reasoning
                if (inThinkingSection && (
                    line.startsWith('*') && line.endsWith('*') || // Markdown emphasis for meta-comments
                    line.match(/^\d+\.\s+\*.*\*:/) || // Numbered list with emphasized headers
                    line.match(/^\d+\.\s+/) || // Any numbered list during thinking
                    line.startsWith('-   ') || // Bullet points with extra spacing (markdown)
                    line.includes('The user is') ||
                    line.includes('My current instruction') ||
                    line.includes('Let\'s consider') ||
                    line.includes('I should') ||
                    line.includes('I cannot') ||
                    line.includes('I must') ||
                    line.includes('refers to') ||
                    line.includes('meaning is'))) {
                    continue;
                }
                
                // If we find a line that looks like actual content (Hebrew/English text, reasonable length)
                // and doesn't have meta-markers, consider it the start of the answer
                // Additional check: line should start with actual content, not analysis/meta-discussion
                const looksLikeMetaDiscussion = 
                    line.includes('translates to') ||
                    line.includes('refers to') ||
                    line.includes('means') ||
                    line.includes('can mean') ||
                    line.includes('evokes') ||
                    line.includes('Together, it') ||
                    line.includes('In the context') ||
                    line.includes('Given') ||
                    line.startsWith('The contrast is') ||
                    line.match(/^-\s+["'].*["']:/) || // Definition list format
                    line.match(/^".*".*:$/); // Quoted term with colon (definition)
                
                if (line.length > 0 && 
                    !line.startsWith('*') && 
                    !line.match(/^\d+\.\s+\*/) &&
                    !line.match(/^\d+\.\s+/) && // Skip numbered lists
                    !line.startsWith('-   ') && // Skip markdown bullets
                    !looksLikeMetaDiscussion &&
                    !line.includes('THOUGHT')) {
                    foundAnswerStart = true;
                    inThinkingSection = false;
                    answerLines.push(lines[i]); // Keep original formatting
                } else if (foundAnswerStart && !inThinkingSection) {
                    answerLines.push(lines[i]); // Keep building the answer
                }
            }
            
            if (answerLines.length > 0) {
                finalAnswer = answerLines.join('\n').trim();
                
                // Additional cleanup: remove any remaining markdown meta-comments at the start
                finalAnswer = finalAnswer.replace(/^\*.*?\*\s*\n/gm, '');
                
                // If the answer is still wrapped in quotes (from drafting), extract it
                // e.g., "זו שאלה מעניינת..." -> זו שאלה מעניינת...
                const quotedMatch = finalAnswer.match(/^"(.+)"$/s);
                if (quotedMatch) {
                    finalAnswer = quotedMatch[1].trim();
                    console.log('🧹 Removed surrounding quotes from answer');
                }
                
                if (finalAnswer && finalAnswer.length > 10) {
                    text = finalAnswer;
                    console.log(`🎯 Extracted final answer (${finalAnswer.length} chars)`);
                    console.log(`   Preview: ${finalAnswer.substring(0, 100)}...`);
                }
            } else {
                // Fallback: If mostly English text with Hebrew ending, extract Hebrew part
                const allLines = text.split('\n');
                const hebrewLines = [];
                let foundHebrewSection = false;
                
                // Hebrew character detection
                const hasHebrew = (str) => /[\u0590-\u05FF]/.test(str);
                
                // Scan from bottom up for Hebrew content
                for (let i = allLines.length - 1; i >= 0; i--) {
                    const line = allLines[i].trim();
                    if (!line) continue;
                    
                    if (hasHebrew(line)) {
                        hebrewLines.unshift(allLines[i]); // Keep original formatting
                        foundHebrewSection = true;
                    } else if (foundHebrewSection) {
                        // Stop when we hit English after finding Hebrew
                        break;
                    }
                }
                
                if (hebrewLines.length > 0 && hebrewLines.join('').length > 20) {
                    const hebrewAnswer = hebrewLines.join('\n').trim();
                    text = hebrewAnswer;
                    console.log(`🎯 Extracted Hebrew final answer from mixed response (${hebrewAnswer.length} chars)`);
                    console.log(`   Preview: ${hebrewAnswer.substring(0, 100)}...`);
                } else {
                    // Fallback: Try to find the last substantial paragraph that looks like a real answer
                    // Split by double newlines to get paragraphs
                    const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);
                    
                    // Look for the last paragraph that doesn't contain meta-discussion markers
                    for (let i = paragraphs.length - 1; i >= 0; i--) {
                        const para = paragraphs[i].trim();
                        
                        // Check if this paragraph looks like a real answer (not meta-discussion)
                        const isMetaParagraph = 
                            para.includes('As an AI') ||
                            para.includes('translates to') ||
                            para.includes('refers to') ||
                            para.includes('Let\'s break down') ||
                            para.includes('My response should') ||
                            para.match(/^\d+\.\s+\*/) || // Numbered list with emphasis
                            para.match(/^-\s+["'].*["']:/) || // Definition list
                            para.startsWith('THOUGHT');
                        
                        if (!isMetaParagraph && para.length > 20) {
                            finalAnswer = para;
                            console.log('🎯 Found final answer paragraph (fallback method)');
                            console.log(`   Preview: ${finalAnswer.substring(0, 100)}...`);
                            text = finalAnswer;
                            break;
                        }
                    }
                }
            }
        }
        
        console.log(`✅ Gemini text generated: ${text.substring(0, 100)}...`);
        
        return {
            text: text,
            originalPrompt: cleanPrompt,
            metadata: {
                service: 'Gemini',
                model: options.model || "gemini-2.5-flash",
                type: 'text_generation',
                characterCount: text.length,
                created_at: new Date().toISOString()
            }
        };
        
    } catch (err) {
        console.error('❌ Gemini text generation error:', err);
        
        // Emergency response
        return { 
            text: 'מצטער, קרתה שגיאה בעיבוד הבקשה שלך עם Gemini. נסה שוב מאוחר יותר.',
            error: err.message || 'Text generation failed' 
        };
    }
}

/**
 * Generate chat summary using Gemini
 */
async function generateChatSummary(messages) {
    try {
        console.log(`📝 Generating chat summary for ${messages.length} messages`);
        
        // Format messages for Gemini
        let formattedMessages = '';
        messages.forEach((msg, index) => {
            // Handle timestamp - Green API can return seconds or milliseconds
            let timestamp;
            if (msg.timestamp) {
                // If timestamp is less than year 2000 in milliseconds, it's probably in seconds
                const ts = typeof msg.timestamp === 'number' ? msg.timestamp : parseInt(msg.timestamp);
                timestamp = ts < 946684800000 ? new Date(ts * 1000) : new Date(ts);
            } else if (msg.timestampMessage) {
                // Alternative timestamp field
                const ts = typeof msg.timestampMessage === 'number' ? msg.timestampMessage : parseInt(msg.timestampMessage);
                timestamp = ts < 946684800000 ? new Date(ts * 1000) : new Date(ts);
            } else {
                timestamp = new Date(); // Fallback to current time
            }
            const timestampStr = timestamp.toLocaleString('he-IL');
            
            // Use WhatsApp display name only (chatName), fallback to phone number
            let sender = 'משתמש';
            if (msg.chatName) {
                sender = msg.chatName;
            } else if (msg.senderName) {
                sender = msg.senderName;
            } else if (msg.sender) {
                // Extract phone number from sender ID (e.g., "972543995202@c.us" -> "972543995202")
                const phoneMatch = msg.sender.match(/^(\d+)@/);
                sender = phoneMatch ? phoneMatch[1] : msg.sender;
            }
            
            // Get message text - Green API format
            let messageText = msg.textMessage || msg.caption || '';
            
            // If no text found, check extendedTextMessage
            if (!messageText && msg.typeMessage === 'extendedTextMessage' && msg.extendedTextMessage) {
                messageText = msg.extendedTextMessage.text || '';
            }
            
            // If still no text, it's media only
            if (!messageText) {
                messageText = '[מדיה]';
            }
            
            formattedMessages += `${index + 1}. ${timestampStr} - ${sender}: ${messageText}\n`;
        });
        
        const summaryPrompt = `אנא צור סיכום קצר וברור של השיחה הבאה. התמקד בנושאים העיקריים, החלטות שהתקבלו, ונקודות חשובות.

חשוב: הסיכום חייב להיות בעברית.

הודעות השיחה:
${formattedMessages}

סיכום השיחה:`;

        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent(summaryPrompt);
        
        if (!result.response) {
            throw new Error('No response from Gemini');
        }
        
        const summaryText = result.response.text();
        console.log(`✅ Chat summary generated: ${summaryText.length} characters`);
        
        return {
            success: true,
            text: summaryText
        };
        
    } catch (err) {
        console.error('❌ Chat summary generation error:', err);
        return {
            success: false,
            error: err.message || 'Chat summary generation failed'
        };
    }
}

/**
 * Translate text to target language
 * @param {string} text - Text to translate
 * @param {string} targetLanguage - Target language
 * @returns {Object} - Translation result
 */
async function translateText(text, targetLanguage) {
    try {
        console.log(`🌐 Translating "${text}" to ${targetLanguage}`);
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash" 
        });
        
        const translationPrompt = `Translate the following text to ${targetLanguage}. Return ONLY the translated text, nothing else.

Text to translate: "${text}"

Important: Return only the translation, no explanations, no quotes, no extra text.`;

        const result = await model.generateContent(translationPrompt);
        const response = result.response;
        
        if (!response.candidates || response.candidates.length === 0) {
            console.log('❌ Gemini translation: No candidates returned');
            return { 
                success: false, 
                error: 'Translation failed: No response from Gemini' 
            };
        }
        
        const translatedText = response.text().trim();
        
        console.log(`✅ Translation complete: "${translatedText}"`);
        
        return {
            success: true,
            translatedText: translatedText
        };
        
    } catch (err) {
        console.error('❌ Translation error:', err);
        return { 
            success: false, 
            error: err.message || 'Translation failed' 
        };
    }
}

module.exports = {
  generateTextResponse,
  generateChatSummary,
  translateText
};
