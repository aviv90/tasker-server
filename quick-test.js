// Quick test for the fixed Text to Song
const axios = require('axios');

async function quickTest() {
    console.log('🎵 Quick test for Text to Song...');
    
    try {
        const response = await axios.post('http://localhost:3000/api/start-task', {
            type: 'text-to-song',
            prompt: 'שיר שמח קצר'
        });
        
        console.log('✅ Task started:', response.data);
        
        // Check status once
        setTimeout(async () => {
            try {
                const status = await axios.get(`http://localhost:3000/api/task-status/${response.data.taskId}`);
                console.log('📊 Current status:', status.data);
            } catch (error) {
                console.error('❌ Status check error:', error.message);
            }
        }, 5000);
        
    } catch (error) {
        console.error('❌ Test error:', error.response?.data || error.message);
    }
}

quickTest();
