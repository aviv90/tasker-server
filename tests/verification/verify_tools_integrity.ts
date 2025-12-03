
import { allTools } from '../../services/agent/tools/index';


async function verifyTools() {
    console.log('Verifying tools integrity...');

    const requiredTools = [
        'create_image',
        'create_video',
        'transcribe_audio',
        'text_to_speech',
        'creative_audio_mix'
    ];

    const missingTools = [];

    for (const toolName of requiredTools) {
        if (!allTools[toolName]) {
            console.error(`❌ Missing tool: ${toolName}`);
            missingTools.push(toolName);
        } else {
            console.log(`✅ Found tool: ${toolName}`);
        }
    }

    if (missingTools.length > 0) {
        console.error('Verification FAILED');
        process.exit(1);
    } else {
        console.log('Verification PASSED');
        process.exit(0);
    }
}

verifyTools().catch(err => {
    console.error('Error running verification:', err);
    process.exit(1);
});
