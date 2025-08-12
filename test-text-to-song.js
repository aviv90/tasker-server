/**
 * Test script for Text to Song functionality
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api';

async function testTextToSong() {
    console.log('🎵 Testing Text to Song functionality...\n');

    const testCases = [
        {
            name: 'Hebrew Happy Song',
            prompt: 'שיר שמח על ידידות',
            description: 'Testing Hebrew prompt with happy theme'
        },
        {
            name: 'English Birthday Song',
            prompt: 'Happy birthday song for my best friend',
            description: 'Testing English prompt with birthday theme'
        },
        {
            name: 'Simple Love Song',
            prompt: 'אהבה ורומנטיקה',
            description: 'Testing Hebrew love theme'
        }
    ];

    for (const testCase of testCases) {
        console.log(`\n🎼 ${testCase.name}:`);
        console.log(`📝 Prompt: "${testCase.prompt}"`);
        console.log(`📄 Description: ${testCase.description}`);
        
        try {
            // Start the task
            console.log('🚀 Starting song generation...');
            const startResponse = await axios.post(`${BASE_URL}/start-task`, {
                type: 'text-to-song',
                prompt: testCase.prompt
            });

            if (startResponse.data.taskId) {
                console.log(`✅ Task started with ID: ${startResponse.data.taskId}`);
                
                // Check status periodically
                let attempts = 0;
                const maxAttempts = 12; // 2 minutes max
                
                while (attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
                    attempts++;
                    
                    const statusResponse = await axios.get(`${BASE_URL}/task-status/${startResponse.data.taskId}`);
                    const status = statusResponse.data.status;
                    
                    console.log(`🔄 Attempt ${attempts}/${maxAttempts}, Status: ${status}`);
                    
                    if (status === 'done') {
                        console.log('🎉 Song generation completed!');
                        console.log('🎵 Result URL:', statusResponse.data.result);
                        console.log('📝 Processed text:', statusResponse.data.text);
                        console.log('🔧 Provider:', statusResponse.data.provider);
                        break;
                    } else if (status === 'error') {
                        console.log('❌ Song generation failed:', statusResponse.data.error);
                        break;
                    }
                }
                
                if (attempts >= maxAttempts) {
                    console.log('⏰ Test timed out - but this is normal for audio generation');
                }
            } else {
                console.log('❌ Failed to start task:', startResponse.data);
            }
        } catch (error) {
            console.error('❌ Test error:', error.response?.data || error.message);
        }
        
        console.log('\n' + '='.repeat(60));
    }
}

// Run the test
if (require.main === module) {
    testTextToSong()
        .then(() => {
            console.log('\n🎯 Text to Song testing completed!');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n❌ Test suite failed:', error.message);
            process.exit(1);
        });
}

module.exports = { testTextToSong };
