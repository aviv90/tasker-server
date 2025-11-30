import { TOOLS, getToolsByCategory } from '../config/tools-list';

console.log('Verifying TOOLS export...');
const toolCount = Object.keys(TOOLS).length;
console.log(`Total tools: ${toolCount}`);

if (toolCount === 0) {
    console.error('❌ No tools found!');
    process.exit(1);
}

const categories = ['location', 'creation', 'analysis', 'editing', 'audio', 'search', 'context', 'meta'];
categories.forEach(cat => {
    const tools = getToolsByCategory(cat);
    console.log(`Category ${cat}: ${tools.length} tools`);
});

console.log('✅ Verification successful!');
