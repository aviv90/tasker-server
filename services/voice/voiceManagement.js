/**
 * Voice management helpers for ElevenLabs integration
 * Extracted from voiceService.js (Phase 5.3)
 */

/**
 * Get all voices
 */
async function getVoices() {
    try {
        const client = this.initializeClient();
        const voices = await client.voices.getAll();
        
        const voiceList = voices.voices || voices.data?.voices || [];
        
        console.log(`🎤 Retrieved ${voiceList.length} voices from ElevenLabs`);
        
        return {
            voices: voiceList,
            total: voiceList.length
        };
    } catch (err) {
        console.error('❌ Error fetching voices:', err.message);
        return { error: err.message || 'Failed to fetch voices' };
    }
}

/**
 * Get voice details
 */
async function getVoice(voiceId) {
    try {
        const client = this.initializeClient();
        const voice = await client.voices.get(voiceId);
        
        return voice || voice.data || {};
    } catch (err) {
        console.error('❌ Error fetching voice:', err.message);
        return { error: err.message || 'Failed to fetch voice details' };
    }
}

/**
 * Delete a voice
 */
async function deleteVoice(voiceId) {
    try {
        const client = this.initializeClient();
        await client.voices.delete(voiceId);
        
        console.log(`✅ Voice deleted: ${voiceId}`);
        return { success: true, voiceId };
    } catch (err) {
        console.error('❌ Error deleting voice:', err.message);
        return { error: err.message || 'Failed to delete voice' };
    }
}

module.exports = {
    getVoices,
    getVoice,
    deleteVoice
};

