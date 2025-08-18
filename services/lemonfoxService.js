const FormData = require('form-data');
const axios = require('axios');

async function transcribeAudio(audioBuffer, filename = 'audio.wav') {
    try {
        console.log('🎤 Starting audio transcription');
        
        const formData = new FormData();
        formData.append('file', audioBuffer, filename);
        formData.append('language', 'english');
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
        
        // Enhanced error handling for Lemonfox
        if (err.response) {
            const status = err.response.status;
            const errorData = err.response.data;
            
            if (status === 401) {
                return { error: 'Lemonfox authentication failed. Please check your API key.' };
            }
            if (status === 402) {
                return { error: 'Insufficient credits in your Lemonfox account. Please add credits to continue.' };
            }
            if (status === 422) {
                return { error: 'Audio file format not supported. Please use WAV, MP3, or M4A format.' };
            }
            if (status === 429) {
                return { error: 'Rate limit exceeded. Please wait a moment before trying again.' };
            }
            if (status >= 500) {
                return { error: 'Lemonfox service is temporarily unavailable. Please try again later.' };
            }
            
            return { error: errorData?.error || `Transcription failed with status: ${status}` };
        }
        
        // Check for specific error messages
        const errorMessage = err.message || err.toString();
        if (errorMessage.includes('network') || errorMessage.includes('ECONNREFUSED')) {
            return { error: 'Network connection failed. Please check your internet connection.' };
        }
        if (errorMessage.includes('timeout')) {
            return { error: 'Audio transcription is taking longer than expected. Please try again.' };
        }
        if (errorMessage.includes('insufficient credits') || errorMessage.includes('billing')) {
            return { error: 'Insufficient credits in your Lemonfox account. Please add credits to continue.' };
        }
        
        return { error: errorMessage || 'Audio transcription failed' };
    }
}

module.exports = { transcribeAudio };
