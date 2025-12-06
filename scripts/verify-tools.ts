import { TOOLS, getToolsByCategory } from '../config/tools-list';
import logger from '../utils/logger';

logger.info('Verifying TOOLS export...');
const toolCount = Object.keys(TOOLS).length;
logger.info(`Total tools: ${toolCount}`);

if (toolCount === 0) {
    logger.error('❌ No tools found!');
    process.exit(1);
}

const categories = ['location', 'creation', 'analysis', 'editing', 'audio', 'search', 'context', 'meta'];
categories.forEach(cat => {
    const tools = getToolsByCategory(cat);
    logger.info(`Category ${cat}: ${tools.length} tools`);
});

logger.info('✅ Verification successful!');
