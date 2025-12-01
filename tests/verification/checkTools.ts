
import { allTools } from '../../services/agent/tools/index';
import { TOOL_ACK_MESSAGES } from '../../services/agent/config/constants';

async function checkTools() {
    console.log('🔍 Starting Tool Verification Scan...');

    const toolNames = Object.keys(allTools);
    console.log(`📦 Found ${toolNames.length} tools registered in index.ts`);

    const errors: string[] = [];

    // Check 1: All tools have ACK messages
    console.log('\nChecking ACK messages...');
    toolNames.forEach(toolName => {
        if (!TOOL_ACK_MESSAGES[toolName]) {
            errors.push(`❌ Missing ACK message for tool: ${toolName}`);
        } else {
            // console.log(`✅ ${toolName}: ${TOOL_ACK_MESSAGES[toolName]}`);
        }
    });

    // Check 2: Critical tools presence
    console.log('\nChecking critical tools...');
    const criticalTools = [
        'schedule_message',
        'smart_execute_with_fallback',
        'retry_with_different_provider',
        'get_chat_history',
        'create_image',
        'search_web'
    ];

    criticalTools.forEach(tool => {
        if (!allTools[tool]) {
            errors.push(`❌ Critical tool missing: ${tool}`);
        } else {
            console.log(`✅ Critical tool found: ${tool}`);
        }
    });

    if (errors.length > 0) {
        console.error('\n❌ Verification Failed with errors:');
        errors.forEach(err => console.error(err));
        process.exit(1);
    } else {
        console.log('\n✅ All checks passed! System is consistent.');
        process.exit(0);
    }
}

checkTools().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
