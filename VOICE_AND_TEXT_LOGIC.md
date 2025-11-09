# Logic Flow: Voice & Text Processing

## 📋 Overview

This document describes ALL scenarios and their expected behavior for both OLD and NEW (Agent) mechanisms.

---

## 1️⃣ **Text Messages (New or Quoted)**

### Scenario A: Simple text message
**Input:** "שלום מה שלומך?"
**Expected:** Gemini text response
**Agent Tool:** None (direct Gemini response)

### Scenario B: Text-to-speech without translation
**Input:** "אמור שלום"
**Expected:** Voice output (Hebrew TTS)
**Agent Tool:** `text_to_speech`
- No translation
- Random voice for Hebrew

### Scenario C: Text-to-speech with translation
**Input:** "אמור שלום ביפנית"
**Expected:** Voice output (Japanese TTS of "שלום" translated)
**Agent Tool:** `translate_and_speak`
- Translate "שלום" to Japanese
- Japanese TTS with random Japanese voice

### Scenario D: Quoted text + text-to-speech with translation
**Input:** Quote("היי מה נשמע") + "אמור ביפנית"
**Expected:** Voice output (Japanese TTS of "היי מה נשמע" translated)
**Agent Tool:** `translate_and_speak`
- Extract quoted text: "היי מה נשמע"
- Translate to Japanese
- Japanese TTS with random Japanese voice

### Scenario E: Text translation only (no voice)
**Input:** "תרגם ״שלום״ ליפנית"
**Expected:** Text output (Japanese text)
**Agent Tool:** `translate_text`
- Returns text only, NOT audio

---

## 2️⃣ **Audio Messages (New or Quoted)**

### Scenario F: New audio message (auto-response)
**Input:** User sends voice recording "שלום איך אתה?"
**Expected:** Voice response (Hebrew TTS)
**Current:** Works in OLD mechanism via `handleVoiceMessage`
**Agent:** ❌ **NOT YET IMPLEMENTED**

**Required Flow:**
1. STT (Speech-to-Text)
2. Detect language
3. Check duration >= 4.6s → clone voice OR use random
4. Generate Gemini response (in same language)
5. TTS with cloned/random voice
6. Return audio

### Scenario G: Quoted audio (short, <4.6s) + command
**Input:** Quote(audio <4.6s) + "אמור ביפנית"
**Expected:** Voice output (Japanese TTS)
**Agent Tool:** `translate_and_speak`
- STT the quoted audio
- Translate transcribed text to Japanese
- Japanese TTS with random voice (too short to clone)

### Scenario H: Quoted audio (long, >=4.6s) + command
**Input:** Quote(audio >=4.6s) + "אמור ביפנית"
**Expected:** Voice output (Japanese TTS with cloned voice!)
**Agent Tool:** `translate_and_speak`
- STT the quoted audio
- Translate transcribed text to Japanese
- **Clone voice from quoted audio**
- Japanese TTS with **cloned voice**

### Scenario I: Quoted audio + text extraction request
**Input:** Quote(audio) + "מה נאמר בהקלטה?"
**Expected:** Text output (transcription)
**Agent Tool:** `analyze_audio` (or similar - NOT YET IMPLEMENTED)

---

## 3️⃣ **Summary: What's Missing in Agent?**

### ✅ Already Implemented:
- Text → Text (Gemini response)
- Text → Voice (TTS)
- Text → Translation → Voice (translate_and_speak)
- Quoted text → Translation → Voice (translate_and_speak with quoted context)
- Quoted audio → Translation → Voice WITH voice cloning (translate_and_speak)

### ❌ Missing:
1. **New audio message → Auto voice response** (Scenario F)
   - Currently handled by `handleVoiceMessage` in OLD mechanism
   - Agent needs a tool for this (or handle it outside Agent)

2. **Quoted audio → STT → Text** (Scenario I)
   - Agent needs a tool to transcribe quoted audio and return text

3. **Voice cloning for general commands** (beyond translate_and_speak)
   - Need `voice_clone_and_speak` tool improvements

---

## 4️⃣ **Decision Matrix**

| User Input                          | Quoted? | Type   | Output | Tool/Flow                      | Voice Clone? |
|-------------------------------------|---------|--------|--------|--------------------------------|--------------|
| "היי"                               | No      | Text   | Text   | Gemini direct                  | N/A          |
| "אמור שלום"                         | No      | Text   | Voice  | `text_to_speech`               | No           |
| "אמור שלום ביפנית"                  | No      | Text   | Voice  | `translate_and_speak`          | No           |
| Quote(text) + "אמור ביפנית"        | Yes     | Text   | Voice  | `translate_and_speak`          | No           |
| Quote(audio <4.6s) + "אמור ביפנית" | Yes     | Audio  | Voice  | `translate_and_speak`          | No (too short) |
| Quote(audio >=4.6s) + "אמור ביפנית"| Yes     | Audio  | Voice  | `translate_and_speak`          | **YES** ✅    |
| New audio message                   | No      | Audio  | Voice  | **`handleVoiceMessage` (OLD)** | If >=4.6s    |
| Quote(audio) + "מה נאמר?"           | Yes     | Audio  | Text   | **Missing tool**               | N/A          |

---

## 5️⃣ **Recommendations**

### Short-term (Critical):
1. **Keep `handleVoiceMessage` for NEW audio messages** (outside Agent for now)
   - It's complex and works well
   - Agent can call it as needed

2. **Add `transcribe_audio` tool** for quoted audio → text
   ```javascript
   transcribe_audio({
     audio_url: string  // From quoted audio
   }) → { text: string, language: string }
   ```

### Long-term (Optimization):
1. **Unified voice response tool** that handles:
   - Auto-response (new audio)
   - Quoted audio + command
   - Voice cloning logic
   - Language detection

2. **Better Agent instructions** for when to use voice vs text

---

## 6️⃣ **Testing Checklist**

- [ ] Text → Text response
- [ ] "אמור X" → Voice (Hebrew)
- [ ] "אמור X ביפנית" → Voice (Japanese)
- [ ] Quote(text) + "אמור ביפנית" → Voice (Japanese)
- [ ] Quote(audio <4.6s) + "אמור ביפנית" → Voice (Japanese, random)
- [ ] Quote(audio >=4.6s) + "אמור ביפנית" → Voice (Japanese, cloned)
- [ ] New audio → Voice response (same language, cloned if possible)
- [ ] Quote(audio) + "מה נאמר?" → Text transcription

---

**Last Updated:** 2025-11-09

