
import { allTools } from '../../services/agent/tools/index';
import logger from '../../utils/logger';


async function verifyTools() {
    logger.info('Verifying tools integrity...');

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
            logger.error(`❌ Missing tool: ${toolName}`);
            missingTools.push(toolName);
        } else {
            logger.info(`✅ Found tool: ${toolName}`);
        }
    }

    if (missingTools.length > 0) {
        logger.error('Verification FAILED');
        process.exit(1);
    } else {
        logger.info('Verification PASSED');
        process.exit(0);
    }
}

verifyTools().catch(err => {
    logger.error('Error running verification:', err);
    process.exit(1);
});
