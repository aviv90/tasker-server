const FormData = require('form-data');
const axios = require('axios');

async function transcribeAudio(audioBuffer, filename = 'audio.wav') {
    try {
        console.log('🎤 Starting audio transcription');
        
        const formData = new FormData();
        formData.append('file', audioBuffer, filename);
        formData.append('language', 'hebrew');
        formData.append('response_format', 'json');
        
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
            const errorData = err.response.data;
            
            if (status === 401) {
                return { error: errorData?.error || 'Invalid API key or authentication failed' };
            } else if (status === 422) {
                return { error: errorData?.error || 'Audio file format not supported or invalid' };
            } else if (status === 429) {
                return { error: errorData?.error || 'Rate limit exceeded - please try again later' };
            } else {
                return { error: errorData?.error || `Transcription failed with status: ${status}` };
            }
        }
        
        // Return original error messages when possible
        if (err.message.includes('network') || err.message.includes('ECONNREFUSED')) {
            return { error: err.message };
        } else if (err.message.includes('timeout')) {
            return { error: err.message };
        } else {
            return { error: err.message || 'Audio transcription failed' };
        }
    }
}

module.exports = { transcribeAudio };
