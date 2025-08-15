// Quick test for the server functionality
const axios = require('axios');

async function quickTest() {
    console.log('🚀 Quick test for server functionality...');
    
    try {
        const response = await axios.post('http://localhost:3000/api/start-task', {
            type: 'text-to-image',
            prompt: 'A beautiful sunset over mountains'
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
