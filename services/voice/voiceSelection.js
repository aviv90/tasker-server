/**
 * Voice selection helpers for ElevenLabs integration
 * Extracted from voiceService.js (Phase 5.3)
 */

async function getRandomVoice() {
    try {
        const voicesResult = await this.getVoices();
        if (voicesResult.error) {
            return { error: voicesResult.error };
        }
        
        const voices = voicesResult.voices || [];
        if (voices.length === 0) {
            return { error: 'No voices available' };
        }
        
        const availableVoices = voices.filter(voice => 
            (voice.voice_id || voice.voiceId || voice.id) && 
            voice.category !== 'cloned'
        );
        
        if (availableVoices.length === 0) {
            const randomIndex = Math.floor(Math.random() * voices.length);
            const selectedVoice = voices[randomIndex];
            console.log(`🎲 Fallback: Selected any voice: ${selectedVoice.name}`);
            
            return {
                voiceId: selectedVoice.voice_id || selectedVoice.voiceId || selectedVoice.id,
                voiceName: selectedVoice.name,
                voiceCategory: selectedVoice.category
            };
        }
        
        const randomIndex = Math.floor(Math.random() * availableVoices.length);
        const selectedVoice = availableVoices[randomIndex];
        
        console.log(`🎲 Selected random voice: ${selectedVoice.name}`);
        
        return {
            voiceId: selectedVoice.voice_id || selectedVoice.voiceId || selectedVoice.id,
            voiceName: selectedVoice.name,
            voiceCategory: selectedVoice.category
        };
    } catch (err) {
        console.error('❌ Error getting random voice:', err.message);
        return { error: err.message || 'Failed to get random voice' };
    }
}

async function getVoiceForLanguage(languageCode) {
    try {
        const voicesResult = await this.getVoices();
        if (voicesResult.error) {
            return { error: voicesResult.error };
        }
        
        const voices = voicesResult.voices || [];
        if (voices.length === 0) {
            return { error: 'No voices available' };
        }
        
        const languageVoicePreferences = {
            'he': ['Bella', 'Antoni', 'Elli', 'Josh', 'Arnold', 'Adam', 'Callum', 'Charlie', 'Daniel'],
            'en': ['Rachel', 'Drew', 'Clyde', 'Paul', 'Domi'],
            'es': ['Bella', 'Antoni', 'Elli', 'Josh', 'Arnold'],
            'fr': ['Bella', 'Antoni', 'Elli', 'Josh', 'Arnold'],
            'de': ['Bella', 'Antoni', 'Elli', 'Josh', 'Arnold'],
            'it': ['Bella', 'Antoni', 'Elli', 'Josh', 'Arnold'],
            'pt': ['Bella', 'Antoni', 'Elli', 'Josh', 'Arnold'],
            'ru': ['Bella', 'Antoni', 'Elli', 'Josh', 'Arnold'],
            'ar': ['Bella', 'Antoni', 'Elli', 'Josh', 'Arnold'],
            'zh': ['Bella', 'Antoni', 'Elli', 'Josh', 'Arnold'],
            'ja': ['Bella', 'Antoni', 'Elli', 'Josh', 'Arnold'],
            'hi': ['Bella', 'Antoni', 'Elli', 'Josh', 'Arnold']
        };
        
        const preferredVoices = languageVoicePreferences[languageCode] || languageVoicePreferences['en'];
        
        const availableVoices = voices.filter(voice => 
            (voice.voice_id || voice.voiceId || voice.id) && 
            voice.category !== 'cloned'
        );
        
        if (availableVoices.length === 0) {
            const randomIndex = Math.floor(Math.random() * voices.length);
            const selectedVoice = voices[randomIndex];
            console.log(`🎲 Fallback: Selected any voice: ${selectedVoice.name}`);
            
            return {
                voiceId: selectedVoice.voice_id || selectedVoice.voiceId || selectedVoice.id,
                voiceName: selectedVoice.name,
                voiceCategory: selectedVoice.category
            };
        }
        
        for (const preferredName of preferredVoices) {
            const preferredVoice = availableVoices.find(voice => 
                voice.name && voice.name.toLowerCase().includes(preferredName.toLowerCase())
            );
            
            if (preferredVoice) {
                console.log(`🎯 Found preferred voice for ${languageCode}: ${preferredVoice.name}`);
                return {
                    voiceId: preferredVoice.voice_id || preferredVoice.voiceId || preferredVoice.id,
                    voiceName: preferredVoice.name,
                    voiceCategory: preferredVoice.category
                };
            }
        }
        
        const randomIndex = Math.floor(Math.random() * availableVoices.length);
        const selectedVoice = availableVoices[randomIndex];
        
        console.log(`🎲 Selected random voice for ${languageCode}: ${selectedVoice.name}`);
        
        return {
            voiceId: selectedVoice.voice_id || selectedVoice.voiceId || selectedVoice.id,
            voiceName: selectedVoice.name,
            voiceCategory: selectedVoice.category
        };
    } catch (err) {
        console.error('❌ Error getting voice for language:', err.message);
        return { error: err.message || 'Failed to get voice for language' };
    }
}

function detectLanguage(text) {
    if (!text || typeof text !== 'string') {
        return 'en';
    }
    
    const hebrewRegex = /[\u0590-\u05FF]|[א-ת]/;
    if (hebrewRegex.test(text)) {
        const hebrewChars = (text.match(/[\u0590-\u05FF]|[א-ת]/g) || []).length;
        const totalChars = text.replace(/[\s\n\r\t]/g, '').length;
        const hebrewRatio = hebrewChars / Math.max(totalChars, 1);
        
        if (hebrewRatio >= 0.3) {
            return 'he';
        }
    }
    
    const arabicRegex = /[\u0600-\u06FF]/;
    if (arabicRegex.test(text)) {
        return 'ar';
    }
    
    const russianRegex = /[\u0400-\u04FF]/;
    if (russianRegex.test(text)) {
        return 'ru';
    }
    
    const spanishRegex = /[ñáéíóúüÑÁÉÍÓÚÜ]/;
    if (spanishRegex.test(text)) {
        return 'es';
    }
    
    const frenchRegex = /[àâäéèêëïîôöùûüÿçÀÂÄÉÈÊËÏÎÔÖÙÛÜŸÇ]/;
    if (frenchRegex.test(text)) {
        return 'fr';
    }
    
    const germanRegex = /[äöüßÄÖÜ]/;
    if (germanRegex.test(text)) {
        return 'de';
    }
    
    return 'en';
}

async function textToSpeechWithRandomVoice(text, options = {}) {
    try {
        console.log(`🎲 Starting TTS with random voice for text: "${text.substring(0, 50)}..."`);
        
        const detectedLanguage = this.detectLanguage(text);
        console.log(`🌐 Detected language: ${detectedLanguage}`);
        
        const voiceResult = await this.getVoiceForLanguage(detectedLanguage);
        if (voiceResult.error) {
            return { error: `Failed to get voice for language ${detectedLanguage}: ${voiceResult.error}` };
        }
        
        const { voiceId, voiceName, voiceCategory } = voiceResult;
        console.log(`🎤 Using voice: ${voiceName} (category: ${voiceCategory}) for language: ${detectedLanguage}`);
        console.log(`🔤 Text contains Hebrew: ${text.match(/[\u0590-\u05FF]|[א-ת]/) ? 'YES' : 'NO'}`);
        
        if (!voiceId) {
            return { error: 'No voice ID received from voice selection' };
        }
        
        const ttsOptions = {
            ...options,
            languageCode: detectedLanguage,
            modelId: options.modelId || 'eleven_v3'
        };
        
        const ttsResult = await this.textToSpeech(voiceId, text, ttsOptions);
        
        if (ttsResult.error) {
            return { error: ttsResult.error };
        }
        
        return {
            ...ttsResult,
            voiceInfo: {
                voiceId,
                voiceName,
                voiceCategory
            }
        };
    } catch (err) {
        console.error('❌ Error in TTS with random voice:', err.message);
        return { error: err.message || 'Text-to-speech with random voice failed' };
    }
}

module.exports = {
    getRandomVoice,
    getVoiceForLanguage,
    detectLanguage,
    textToSpeechWithRandomVoice
};

