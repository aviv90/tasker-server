const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Music request parsing
 */
class MusicParser {
  /**
   * Parse music request to detect video requirement
   */
  async parseMusicRequest(prompt) {
    try {
      // First, try simple regex detection for common patterns (fast and reliable)
      const videoPatterns = /\b(with|and|plus|including|include)\s+(video|clip)\b|כולל\s+(וידאו|קליפ)|עם\s+(וידאו|קליפ)|גם\s+(וידאו|קליפ)|ועם\s+(וידאו|קליפ)|\bvideo\s*clip\b|\bmusic\s*video\b/i;

      const regexMatch = videoPatterns.test(prompt);

      if (regexMatch) {
        console.log('🎬 Video requested with music');
        // Clean the prompt by removing video/clip mentions
        const cleanPrompt = prompt
          .replace(/\s*(with|and|plus|including|include)\s+(video|clip)\s*/gi, ' ')
          .replace(/\s*כולל\s+(וידאו|קליפ)\s*/g, ' ')
          .replace(/\s*עם\s+(וידאו|קליפ)\s*/g, ' ')
          .replace(/\s*גם\s+(וידאו|קליפ)\s*/g, ' ')
          .replace(/\s*ועם\s+(וידאו|קליפ)\s*/g, ' ')
          .replace(/\s*video\s*clip\s*/gi, ' ')
          .replace(/\s*music\s*video\s*/gi, ' ')
          .trim()
          .replace(/\s+/g, ' ');

        return {
          wantsVideo: true,
          cleanPrompt: cleanPrompt || prompt
        };
      }

      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash"
      });

      const analysisPrompt = `Analyze this music generation request and determine if the user wants a video along with the song.

User request: "${prompt}"

Return ONLY a JSON object (no markdown, no extra text) with this exact structure:
{
  "wantsVideo": true/false,
  "cleanPrompt": "the music description without video request"
}

Rules:
1. If user explicitly requests video or clip (e.g., "with video", "כולל וידאו", "עם וידאו", "גם וידאו", "plus video", "and video", "ועם וידאו", "קליפ", "כולל קליפ", "עם קליפ", "clip", "with clip", "video clip", "music video"), set wantsVideo=true
2. Extract the actual music description (without the video/clip instruction)
3. Keep the cleanPrompt focused on music style, theme, mood, lyrics topic
4. If no video/clip is mentioned, set wantsVideo=false and keep original prompt
5. IMPORTANT: The presence of other words (like "Suno", "בעזרת", "באמצעות") should NOT affect video detection - focus ONLY on video/clip keywords

Examples:
Input: "צור שיר בסגנון רוק על אהבה כולל וידאו"
Output: {"wantsVideo":true,"cleanPrompt":"צור שיר בסגנון רוק על אהבה"}

Input: "צור שיר על הכלב דובי בעזרת Suno, כולל וידאו"
Output: {"wantsVideo":true,"cleanPrompt":"צור שיר על הכלב דובי בעזרת Suno"}

Input: "create a pop song about summer with video"
Output: {"wantsVideo":true,"cleanPrompt":"create a pop song about summer"}

Input: "שיר עצוב על פרידה עם קליפ"
Output: {"wantsVideo":true,"cleanPrompt":"שיר עצוב על פרידה"}

Input: "שיר רומנטי כולל קליפ"
Output: {"wantsVideo":true,"cleanPrompt":"שיר רומנטי"}

Input: "make a rock song with clip"
Output: {"wantsVideo":true,"cleanPrompt":"make a rock song"}

Input: "make a song with Suno and video"
Output: {"wantsVideo":true,"cleanPrompt":"make a song with Suno"}

Input: "צור שיר ג'אז"
Output: {"wantsVideo":false,"cleanPrompt":"צור שיר ג'אז"}

Input: "make a happy song"
Output: {"wantsVideo":false,"cleanPrompt":"make a happy song"}`;

      const result = await model.generateContent(analysisPrompt);
      const response = result.response;

      if (!response.candidates || response.candidates.length === 0) {
        console.log('❌ Gemini music parsing: No candidates returned');
        return { wantsVideo: false, cleanPrompt: prompt };
      }

      let rawText = response.text().trim();

      // Remove markdown code fences if present
      rawText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '');

      const parsed = JSON.parse(rawText);

      if (parsed.wantsVideo) {
        console.log('🎬 Video requested with music (LLM detected)');
      }
      return parsed;

    } catch (err) {
      console.error('❌ Error parsing music request:', err);
      // Fallback: no video
      return { wantsVideo: false, cleanPrompt: prompt };
    }
  }
}

module.exports = new MusicParser();

