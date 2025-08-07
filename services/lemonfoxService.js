const FormData = require('form-data');
const axios = require('axios');

async function transcribeAudio(audioBuffer, filename = 'audio.wav') {
    try {
        console.log(`🎤 Starting audio transcription for: ${filename}, size: ${audioBuffer.length} bytes`);
        
        const formData = new FormData();
        formData.append('file', audioBuffer, filename);
        formData.append('language', 'hebrew');
        formData.append('response_format', 'json');
        
        console.log('🔗 Sending request to Lemonfox API...');
        const response = await axios.post('https://api.lemonfox.ai/v1/audio/transcriptions', formData, {
            headers: {
                'Authorization': `Bearer ${process.env.LEMONFOX_API_KEY}`,
                ...formData.getHeaders()
            }
        });
        
        const result = response.data;
        
        if (!result || !result.text) {
            console.error('❌ No transcription text in response');
            return { error: 'No transcription text received' };
        }
        
        console.log('✅ Audio transcribed successfully');
        return { 
            text: result.text,
            language: result.language || 'hebrew'
        };
        
    } catch (err) {
        console.error('❌ Audio transcription error:', err.message);
        
        // Handle axios error responses
        if (err.response) {
            const status = err.response.status;
            if (status === 401) {
                return { error: 'Invalid API key or authentication failed' };
            } else if (status === 422) {
                return { error: 'Audio file format not supported or invalid' };
            } else if (status === 429) {
                return { error: 'Rate limit exceeded - please try again later' };
            } else {
                return { error: `Transcription failed: ${status}` };
            }
        }
        
        // Return user-friendly error messages
        if (err.message.includes('network') || err.message.includes('ECONNREFUSED')) {
            return { error: 'Network error - please check your connection' };
        } else if (err.message.includes('timeout')) {
            return { error: 'Transcription timed out - please try again' };
        } else {
            return { error: err.message || 'Audio transcription failed' };
        }
    }
}

module.exports = { transcribeAudio };
