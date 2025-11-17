const { detectLanguage } = require('../../../utils/agentHelpers');

/**
 * Prompt building utilities for Gemini text operations
 */
class PromptBuilder {
  /**
   * Build language-specific instruction
   */
  buildLanguageInstruction(detectedLang) {
    switch (detectedLang) {
      case 'he':
        return 'חשוב מאוד: עליך לענות בעברית בלבד. התשובה חייבת להיות בעברית, ללא מילים באנגלית אלא אם כן זה שם פרטי או מונח טכני שאין לו תרגום.';
      case 'en':
        return 'IMPORTANT: You must respond in English only. The answer must be in English.';
      case 'ar':
        return 'مهم جداً: يجب أن تجيب بالعربية فقط. يجب أن تكون الإجابة بالعربية.';
      case 'ru':
        return 'Очень важно: вы должны отвечать только на русском языке. Ответ должен быть на русском языке.';
      default:
        return 'חשוב מאוד: ענה בעברית בלבד.';
    }
  }

  /**
   * Build system prompt
   */
  buildSystemPrompt(languageInstruction, useGoogleSearch = false) {
    let systemPrompt = `אתה עוזר AI ידידותי. תן תשובות ישירות וטבעיות.

כללי תשובה:
• תשיב ישירות בלבד - ללא הסברים על תהליך החשיבה
• אסור: "As an AI", "My thought process", "Let's break down", "translates to", "I should"
• ${languageInstruction}`;

    // Add Google Search specific instructions
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

    return systemPrompt;
  }

  /**
   * Build model response for system prompt acknowledgment
   */
  buildModelResponse(detectedLang, useGoogleSearch = false) {
    let modelResponse = '';
    
    switch (detectedLang) {
      case 'he':
        modelResponse = 'הבנתי. אשיב ישירות ללא תהליך חשיבה.';
        if (useGoogleSearch) {
          modelResponse += ' **כלי Google Search זמין לי ואני חייב להשתמש בו לכל בקשת קישור.** אסור לי לענות מהזיכרון (2023) או להמציא קישורים. אם החיפוש לא מצא תוצאות - אודיע "לא מצאתי קישור זמין".';
        }
        break;
      case 'en':
        modelResponse = 'Understood. I will respond directly without thinking process.';
        if (useGoogleSearch) {
          modelResponse += ' **Google Search tool is available and I must use it for any link request.** I must not answer from memory (2023) or invent links. If search found no results - I will say "No link available".';
        }
        break;
      case 'ar':
        modelResponse = 'فهمت. سأجيب مباشرة دون عملية تفكير.';
        if (useGoogleSearch) {
          modelResponse += ' **أداة Google Search متاحة ويجب أن أستخدمها لأي طلب رابط.** لا يجب أن أجيب من الذاكرة (2023) أو أختلق روابط. إذا لم يجد البحث نتائج - سأقول "لا يوجد رابط متاح".';
        }
        break;
      case 'ru':
        modelResponse = 'Понял. Буду отвечать напрямую без процесса размышления.';
        if (useGoogleSearch) {
          modelResponse += ' **Инструмент Google Search доступен, и я должен использовать его для любого запроса ссылки.** Я не должен отвечать из памяти (2023) или придумывать ссылки. Если поиск не нашел результатов - я скажу "Ссылка недоступна".';
        }
        break;
      default:
        modelResponse = 'הבנתי. אשיב ישירות ללא תהליך חשיבה.';
        if (useGoogleSearch) {
          modelResponse += ' **כלי Google Search זמין לי ואני חייב להשתמש בו לכל בקשת קישור.** אסור לי לענות מהזיכרון (2023) או להמציא קישורים. אם החיפוש לא מצא תוצאות - אודיע "לא מצאתי קישור זמין".';
        }
    }

    return modelResponse;
  }

  /**
   * Build Google Search example for conversation
   */
  buildGoogleSearchExample(detectedLang) {
    let exampleUser, exampleModel;
    
    switch (detectedLang) {
      case 'he':
        exampleUser = 'שלח לי קישור למזג האוויר בתל אביב';
        exampleModel = '[משתמש בכלי Google Search לחיפוש "מזג אוויר תל אביב"]\n\nהנה קישור לתחזית מזג האוויר בתל אביב: https://www.ims.gov.il/he/cities/2423';
        break;
      case 'en':
        exampleUser = 'Send me a link to weather in Tel Aviv';
        exampleModel = '[Using Google Search tool to search "weather Tel Aviv"]\n\nHere is a link to weather forecast in Tel Aviv: https://www.ims.gov.il/he/cities/2423';
        break;
      case 'ar':
        exampleUser = 'أرسل لي رابط للطقس في تل أبيب';
        exampleModel = '[استخدام أداة Google Search للبحث عن "طقس تل أبيب"]\n\nإليك رابط لتوقعات الطقس في تل أبيب: https://www.ims.gov.il/he/cities/2423';
        break;
      case 'ru':
        exampleUser = 'Отправь мне ссылку на погоду в Тель-Авиве';
        exampleModel = '[Использую инструмент Google Search для поиска "погода Тель-Авив"]\n\nВот ссылка на прогноз погоды в Тель-Авиве: https://www.ims.gov.il/he/cities/2423';
        break;
      default:
        exampleUser = 'שלח לי קישור למזג האוויר בתל אביב';
        exampleModel = '[משתמש בכלי Google Search לחיפוש "מזג אוויר תל אביב"]\n\nהנה קישור לתחזית מזג האוויר בתל אביב: https://www.ims.gov.il/he/cities/2423';
    }

    return {
      user: exampleUser,
      model: exampleModel
    };
  }

  /**
   * Build conversation contents for Gemini
   */
  buildConversationContents(cleanPrompt, conversationHistory = [], useGoogleSearch = false, detectedLang) {
    const contents = [];
    
    // Build system prompt
    const languageInstruction = this.buildLanguageInstruction(detectedLang);
    const systemPrompt = this.buildSystemPrompt(languageInstruction, useGoogleSearch);
    
    // Add system prompt as first user message
    contents.push({
      role: 'user',
      parts: [{ text: systemPrompt }]
    });
    
    // Add model response
    const modelResponse = this.buildModelResponse(detectedLang, useGoogleSearch);
    contents.push({
      role: 'model',
      parts: [{ text: modelResponse }]
    });
    
    // Add Google Search example if enabled
    if (useGoogleSearch) {
      const example = this.buildGoogleSearchExample(detectedLang);
      contents.push({
        role: 'user',
        parts: [{ text: example.user }]
      });
      contents.push({
        role: 'model',
        parts: [{ text: example.model }]
      });
    }

    // Normalize conversation history to an array
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

    return contents;
  }
}

module.exports = new PromptBuilder();

