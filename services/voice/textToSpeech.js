/**
 * Text-to-Speech helper for ElevenLabs integration
 * Extracted from voiceService.js (Phase 5.3)
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

async function textToSpeech(voiceId, text, options = {}) {
    try {
        console.log(`🗣️ Converting text to speech with voice: ${voiceId}`);
        console.log(`📝 Text sample: "${text.substring(0, 100)}..."`);
        
        if (!voiceId || !text) {
            return { error: 'Voice ID and text are required' };
        }

        const client = this.initializeClient();
        
        // Determine language code
        let languageCode = options.languageCode;
        
        if (!languageCode) {
            if (text.match(/[\u0590-\u05FF]|[א-ת]/)) {
                languageCode = 'he';
            } else {
                languageCode = 'en';
            }
        }
        
        const languageMap = {
            'auto': null,
            'unknown': 'he',
            'hebrew': 'he',
            'he': 'he',
            'english': 'en',
            'en': 'en',
            'spanish': 'es',
            'es': 'es',
            'french': 'fr',
            'fr': 'fr',
            'german': 'de',
            'de': 'de',
            'italian': 'it',
            'it': 'it',
            'portuguese': 'pt',
            'pt': 'pt',
            'polish': 'pl',
            'pl': 'pl',
            'turkish': 'tr',
            'tr': 'tr',
            'russian': 'ru',
            'ru': 'ru',
            'dutch': 'nl',
            'nl': 'nl',
            'czech': 'cs',
            'cs': 'cs',
            'arabic': 'ar',
            'ar': 'ar',
            'chinese': 'zh',
            'zh': 'zh',
            'japanese': 'ja',
            'ja': 'ja',
            'hindi': 'hi',
            'hi': 'hi'
        };
        
        if (languageMap.hasOwnProperty(languageCode)) {
            languageCode = languageMap[languageCode];
        }
        
        let modelId = options.modelId || 'eleven_v3';
        
        console.log(`🚀 Using Eleven v3 model for language: ${languageCode || 'auto-detect'}`);
        console.log(`🌐 Language code: ${languageCode || 'auto-detect'}, Model: ${modelId}`);
        
        const ttsRequest = {
            text: text,
            modelId: modelId,
            outputFormat: options.outputFormat || 'mp3_44100_128',
            languageCode: languageCode,
            voiceSettings: options.voiceSettings || null
        };

        if (modelId !== 'eleven_v3' && options.optimizeStreamingLatency !== undefined) {
            ttsRequest.optimizeStreamingLatency = options.optimizeStreamingLatency || 0;
            console.log(`⚡ Added streaming latency optimization: ${ttsRequest.optimizeStreamingLatency}`);
        } else if (modelId === 'eleven_v3') {
            console.log(`⚡ Eleven v3 model - streaming latency optimization not supported (and not needed)`);
        }

        console.log(`🔄 Generating speech for ${text.length} characters...`);
        const audioStream = await client.textToSpeech.convert(voiceId, ttsRequest);

        const chunks = [];
        const reader = audioStream.getReader();
        
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }
        } finally {
            reader.releaseLock();
        }

        const audioBuffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
        
        const tmpDir = path.join(process.cwd(), 'public', 'tmp');
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        
        const audioFileName = `tts_${uuidv4()}.mp3`;
        const audioFilePath = path.join(tmpDir, audioFileName);
        fs.writeFileSync(audioFilePath, audioBuffer);
        
        const audioUrl = `/static/${audioFileName}`;
        
        console.log('✅ Text-to-speech conversion completed');
        console.log(`🔗 Audio available at: ${audioUrl}`);
        
        return {
            audioUrl: audioUrl,
            audioBuffer: audioBuffer,
            voiceId: voiceId,
            text: text,
            metadata: {
                service: 'ElevenLabs',
                type: 'text_to_speech',
                modelId: ttsRequest.modelId,
                outputFormat: ttsRequest.outputFormat,
                textLength: text.length,
                audioSize: audioBuffer.length,
                created_at: new Date().toISOString()
            }
        };

    } catch (err) {
        console.error('❌ Text-to-speech error:', err.message);
        
        if (err.response) {
            const status = err.response.status;
            const message = err.response.data?.detail || err.response.data?.message || err.message;
            
            if (status === 401) {
                return { error: 'Invalid ElevenLabs API key' };
            } else if (status === 402) {
                return { error: 'Insufficient ElevenLabs credits' };
            } else if (status === 404) {
                return { error: 'Voice not found' };
            } else if (status === 422) {
                return { error: `Invalid parameters: ${message}` };
            } else {
                return { error: `ElevenLabs API error (${status}): ${message}` };
            }
        }
        
        return { error: err.message || 'Text-to-speech conversion failed' };
    }
}

module.exports = {
    textToSpeech
};

