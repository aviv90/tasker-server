/**
 * Thinking pattern cleanup utilities
 * Removes verbose thinking/reasoning patterns from Gemini responses
 */
class ThinkingCleanup {
  /**
   * Check if text contains thinking patterns
   */
  hasThinkingPattern(text) {
    return text.includes('SPECIAL INSTRUCTION:') ||
      text.includes('Think step-by-step') ||
      text.startsWith('THOUGHT') ||
      /^THOUGHT\s/m.test(text) ||
      text.includes('*Drafting the response:*') ||
      text.includes('This response:') ||
      text.includes('As an AI, I should:') ||
      text.includes('My response should:') ||
      text.includes('Let\'s break down') ||
      text.includes('The user is essentially asking') ||
      (text.includes('translates to') && text.includes('In the context of')) ||
      text.startsWith('If I were to') ||
      (text.includes('However, as an AI') || text.includes('However, from a technical perspective')) ||
      text.includes('Let\'s consider the implications') ||
      text.includes('Given the instructions to be');
  }

  /**
   * Extract final answer from text with thinking patterns
   */
  extractFinalAnswer(text) {
    const lines = text.split('\n');
    let inThinkingSection = false;
    let answerLines = [];
    let foundAnswerStart = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines at the start
      if (!foundAnswerStart && !line) continue;

      // Detect thinking section markers
      if (this.isThinkingMarker(line)) {
        inThinkingSection = true;
        continue;
      }

      // Skip lines that look like internal reasoning
      if (inThinkingSection && this.isMetaLine(line)) {
        continue;
      }

      // Check if line looks like actual content
      const looksLikeMetaDiscussion = this.isMetaDiscussion(line);

      if (line.length > 0 &&
        !line.startsWith('*') &&
        !line.match(/^\d+\.\s+\*/) &&
        !line.match(/^\d+\.\s+/) &&
        !line.startsWith('-   ') &&
        !looksLikeMetaDiscussion &&
        !line.includes('THOUGHT')) {
        foundAnswerStart = true;
        inThinkingSection = false;
        answerLines.push(lines[i]);
      } else if (foundAnswerStart && !inThinkingSection) {
        answerLines.push(lines[i]);
      }
    }

    if (answerLines.length > 0) {
      let finalAnswer = answerLines.join('\n').trim();

      // Remove markdown meta-comments
      finalAnswer = finalAnswer.replace(/^\*.*?\*\s*\n/gm, '');

      // Remove surrounding quotes
      const quotedMatch = finalAnswer.match(/^"(.+)"$/s);
      if (quotedMatch) {
        finalAnswer = quotedMatch[1].trim();
        console.log('🧹 Removed surrounding quotes from answer');
      }

      if (finalAnswer && finalAnswer.length > 10) {
        console.log(`🎯 Extracted final answer (${finalAnswer.length} chars)`);
        console.log(`   Preview: ${finalAnswer.substring(0, 100)}...`);
        return finalAnswer;
      }
    }

    // Fallback: Extract Hebrew content
    const hebrewAnswer = this.extractHebrewContent(text);
    if (hebrewAnswer) {
      return hebrewAnswer;
    }

    // Fallback: Find last substantial paragraph
    return this.extractLastParagraph(text);
  }

  /**
   * Check if line is a thinking marker
   */
  isThinkingMarker(line) {
    return line.startsWith('THOUGHT') ||
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
      line.includes('Given the instructions');
  }

  /**
   * Check if line is meta/internal reasoning
   */
  isMetaLine(line) {
    return (line.startsWith('*') && line.endsWith('*')) ||
      line.match(/^\d+\.\s+\*.*\*:/) ||
      line.match(/^\d+\.\s+/) ||
      line.startsWith('-   ') ||
      line.includes('The user is') ||
      line.includes('My current instruction') ||
      line.includes('Let\'s consider') ||
      line.includes('I should') ||
      line.includes('I cannot') ||
      line.includes('I must') ||
      line.includes('refers to') ||
      line.includes('meaning is');
  }

  /**
   * Check if line looks like meta-discussion
   */
  isMetaDiscussion(line) {
    return line.includes('translates to') ||
      line.includes('refers to') ||
      line.includes('means') ||
      line.includes('can mean') ||
      line.includes('evokes') ||
      line.includes('Together, it') ||
      line.includes('In the context') ||
      line.includes('Given') ||
      line.startsWith('The contrast is') ||
      line.match(/^-\s+["'].*["']:/) ||
      line.match(/^".*".*:$/);
  }

  /**
   * Extract Hebrew content from mixed text
   */
  extractHebrewContent(text) {
    const allLines = text.split('\n');
    const hebrewLines = [];
    let foundHebrewSection = false;

    const hasHebrew = (str) => /[\u0590-\u05FF]/.test(str);

    // Scan from bottom up for Hebrew content
    for (let i = allLines.length - 1; i >= 0; i--) {
      const line = allLines[i].trim();
      if (!line) continue;

      if (hasHebrew(line)) {
        hebrewLines.unshift(allLines[i]);
        foundHebrewSection = true;
      } else if (foundHebrewSection) {
        break;
      }
    }

    if (hebrewLines.length > 0 && hebrewLines.join('').length > 20) {
      const hebrewAnswer = hebrewLines.join('\n').trim();
      console.log(`🎯 Extracted Hebrew final answer from mixed response (${hebrewAnswer.length} chars)`);
      console.log(`   Preview: ${hebrewAnswer.substring(0, 100)}...`);
      return hebrewAnswer;
    }

    return null;
  }

  /**
   * Extract last substantial paragraph
   */
  extractLastParagraph(text) {
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);

    for (let i = paragraphs.length - 1; i >= 0; i--) {
      const para = paragraphs[i].trim();

      const isMetaParagraph =
        para.includes('As an AI') ||
        para.includes('translates to') ||
        para.includes('refers to') ||
        para.includes('Let\'s break down') ||
        para.includes('My response should') ||
        para.match(/^\d+\.\s+\*/) ||
        para.match(/^-\s+["'].*["']:/) ||
        para.startsWith('THOUGHT');

      if (!isMetaParagraph && para.length > 20) {
        console.log('🎯 Found final answer paragraph (fallback method)');
        console.log(`   Preview: ${para.substring(0, 100)}...`);
        return para;
      }
    }

    return null;
  }

  /**
   * Clean thinking patterns from text
   */
  clean(text) {
    if (!this.hasThinkingPattern(text)) {
      return text;
    }

    console.log('🧹 Detected verbose thinking pattern, extracting final answer...');

    const cleaned = this.extractFinalAnswer(text);
    return cleaned || text;
  }
}

module.exports = new ThinkingCleanup();

