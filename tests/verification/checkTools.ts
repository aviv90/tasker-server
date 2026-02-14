import { allTools } from '../../services/agent/tools/index';
import { TOOL_ACK_MESSAGES } from '../../services/agent/config/constants';
import logger from '../../utils/logger';

async function checkTools() {
    logger.info('🔍 Starting Tool Verification Scan...');

    const toolNames = Object.keys(allTools);
    logger.info(`📦 Found ${toolNames.length} tools registered in index.ts`);

    const errors: string[] = [];

    // Check 1: All tools have ACK messages
    logger.info('\nChecking ACK messages...');
    toolNames.forEach(toolName => {
        if (!TOOL_ACK_MESSAGES[toolName]) {
            errors.push(`❌ Missing ACK message for tool: ${toolName}`);
        } else {
            // logger.debug(`✅ ${toolName}: ${TOOL_ACK_MESSAGES[toolName]}`);
        }
    });

    // Check 2: Critical tools presence
    logger.info('\nChecking critical tools...');
    const criticalTools = [
        'schedule_message',
        'retry_last_command',
        'get_chat_history',
        'create_image',
        'search_web'
    ];

    criticalTools.forEach(tool => {
        if (!allTools[tool]) {
            errors.push(`❌ Critical tool missing: ${tool}`);
        } else {
            logger.info(`✅ Critical tool found: ${tool}`);
        }
    });

    if (errors.length > 0) {
        logger.error('\n❌ Verification Failed with errors:');
        errors.forEach(err => logger.error(err));
        process.exit(1);
    } else {
        logger.info('\n✅ All checks passed! System is consistent.');
        process.exit(0);
    }
}

checkTools().catch(err => {
    logger.error('❌ Fatal error:', err);
    process.exit(1);
});
