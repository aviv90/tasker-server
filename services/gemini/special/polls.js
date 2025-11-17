const { GoogleGenerativeAI } = require('@google/generative-ai');
const { sanitizeText } = require('../../../utils/textSanitizer');
const crypto = require('crypto');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Poll generation operations
 */
class PollGenerator {
  /**
   * Build poll prompt with or without rhyming
   */
  buildPollPrompt(cleanTopic, numOptions, withRhyme) {
    if (withRhyme) {
      return `אתה יוצר סקרים יצירתיים ומשעשעים בעברית עם חריזה מושלמת.

נושא הסקר: ${cleanTopic}

צור סקר עם:
1. שאלה מעניינת ויצירתית (יכולה להיות "מה היית מעדיפ/ה?" או כל שאלה אחרת)
2. בדיוק ${numOptions} תשובות אפשריות
3. ⭐ חשוב ביותר: כל התשובות חייבות לחרוז זו עם זו בחריזה מושלמת! ⭐
4. החריזה חייבת להיות בסוף כל תשובה (המילה האחרונה)
5. התשובות צריכות להיות קצרות (עד 100 תווים כל אחת)
6. התשובות צריכות להיות קשורות לנושא
7. התשובות חייבות להיות משעשעות ויצירתיות

דוגמאות לחרוזים מושלמים:
- נושא: חתולים (2 תשובות)
  שאלה: "מה היית מעדיפ/ה?"
  תשובה 1: "חתול כועס"
  תשובה 2: "נמר לועס"
  (חרוז: כועס / לועס)

- נושא: כלבים (3 תשובות)
  שאלה: "איזה כלב הכי טוב?"
  תשובה 1: "גולדן רטריבר נהדר"
  תשובה 2: "ביגל קטן ויפה בחדר"
  תשובה 3: "פודל לבן שמתגבר"
  (חרוז: נהדר / בחדר / מתגבר)

- נושא: פיצה (4 תשובות)
  שאלה: "איזו פיצה הכי טעימה?"
  תשובה 1: "פיצה עם זיתים"
  תשובה 2: "פלאפל עם חומוס שלמים"
  תשובה 3: "בורקס במילוי עשיר ושמנים"
  תשובה 4: "שווארמה עם בצל וחצילים"
  (חרוז: זיתים / שלמים / שמנים / חצילים)

- נושא: קפה (2 תשובות)
  שאלה: "איך אתה שותה קפה?"
  תשובה 1: "עם חלב וסוכר"
  תשובה 2: "שחור וחזק כמו נמר"
  (חרוז: סוכר / נמר)

חוקים קפדניים:
⭐ החרוז חייב להיות מושלם - המילה האחרונה בכל תשובה חייבת לחרוז!
- התשובות חייבות להיות שונות זו מזו במשמעות
- השאלה מקסימום 255 תווים
- כל תשובה מקסימום 100 תווים
- כל התשובות (${numOptions}) חייבות לחרוז ביחד!

החזר JSON בלבד בפורמט:
{
  "question": "השאלה כאן",
  "options": ["תשובה 1", "תשובה 2"${numOptions > 2 ? ', "תשובה 3"' : ''}${numOptions > 3 ? ', "תשובה 4"' : ''}]
}`;
    } else {
      return `אתה יוצר סקרים יצירתיים ומשעשעים בעברית.

נושא הסקר: ${cleanTopic}

צור סקר עם:
1. שאלה מעניינת ויצירתית (יכולה להיות "מה היית מעדיפ/ה?" או כל שאלה אחרת)
2. בדיוק ${numOptions} תשובות אפשריות
3. התשובות צריכות להיות קצרות (עד 100 תווים כל אחת)
4. התשובות צריכות להיות קשורות לנושא
5. התשובות חייבות להיות משעשעות, יצירתיות, ומעניינות
6. ⭐ חשוב: התשובות לא צריכות לחרוז! ⭐

דוגמאות ללא חריזה:
- נושא: חתולים (2 תשובות)
  שאלה: "איזה חתול היית מעדיפ/ה?"
  תשובה 1: "חתול פרסי רך ונחמד"
  תשובה 2: "חתול רחוב עצמאי ופראי"

- נושא: פיצה (3 תשובות)
  שאלה: "איזו פיצה הכי טעימה?"
  תשובה 1: "מרגריטה קלאסית"
  תשובה 2: "פפרוני עם גבינה"
  תשובה 3: "ירקות טריים ובריאים"

- נושא: קפה (4 תשובות)
  שאלה: "איך אתה שותה קפה?"
  תשובה 1: "אספרסו חזק"
  תשובה 2: "קפוצ'ינו מוקצף"
  תשובה 3: "לאטה עם חלב שקדים"
  תשובה 4: "קר עם קרח"

חוקים קפדניים:
- התשובות חייבות להיות שונות זו מזו במשמעות
- השאלה מקסימום 255 תווים
- כל תשובה מקסימום 100 תווים
- התשובות לא צריכות לחרוז (זה חשוב!)

החזר JSON בלבד בפורמט:
{
  "question": "השאלה כאן",
  "options": ["תשובה 1", "תשובה 2"${numOptions > 2 ? ', "תשובה 3"' : ''}${numOptions > 3 ? ', "תשובה 4"' : ''}]
}`;
    }
  }

  /**
   * Parse and validate poll response
   */
  parsePollResponse(responseText, numOptions) {
    let jsonText = responseText.trim();

    // If wrapped in code fences, strip them
    const fenceMatch = jsonText.match(/```[a-zA-Z]*\n([\s\S]*?)\n```/);
    if (fenceMatch && fenceMatch[1]) {
      jsonText = fenceMatch[1].trim();
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('❌ Failed to parse Gemini poll response:', jsonText);
      throw new Error('Failed to parse poll data from Gemini');
    }

    // Validate the response
    if (!parsed.question || !parsed.options || !Array.isArray(parsed.options)) {
      throw new Error('Invalid poll data structure from Gemini');
    }

    // Validate number of options (must be between 2-4 and match what we requested)
    if (parsed.options.length < 2 || parsed.options.length > 4) {
      throw new Error(`Invalid number of options: ${parsed.options.length} (expected ${numOptions})`);
    }

    // Ensure limits
    if (parsed.question.length > 255) {
      parsed.question = parsed.question.substring(0, 252) + '...';
    }

    // Truncate each option if needed
    parsed.options = parsed.options.map(opt => {
      if (opt.length > 100) {
        return opt.substring(0, 97) + '...';
      }
      return opt;
    });

    return parsed;
  }

  /**
   * Generate creative poll with optional rhyming
   */
  async generateCreativePoll(topic, withRhyme = true) {
    try {
      console.log(`📊 Generating creative poll about: ${topic} ${withRhyme ? '(with rhyme)' : '(without rhyme)'}`);

      const cleanTopic = sanitizeText(topic);

      // Randomly choose number of options (2-4)
      const numOptions = crypto.randomInt(2, 5); // 2, 3, or 4
      console.log(`🎲 Randomly selected ${numOptions} poll options`);

      const pollPrompt = this.buildPollPrompt(cleanTopic, numOptions, withRhyme);

      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash"
      });

      const result = await model.generateContent(pollPrompt);

      if (!result.response) {
        throw new Error('No response from Gemini');
      }

      const responseText = result.response.text();
      const parsed = this.parsePollResponse(responseText, numOptions);

      console.log(`✅ Poll generated successfully with ${parsed.options.length} ${withRhyme ? 'rhyming' : 'non-rhyming'} options:`);
      console.log(`   Question: "${parsed.question}"`);
      parsed.options.forEach((opt, idx) => {
        console.log(`   Option ${idx + 1}: "${opt}"`);
      });

      return {
        success: true,
        question: parsed.question,
        options: parsed.options,
        numOptions: parsed.options.length
      };

    } catch (err) {
      console.error('❌ Poll generation error:', err);
      return {
        success: false,
        error: err.message || 'Failed to generate poll'
      };
    }
  }
}

module.exports = new PollGenerator();

