/**
 * Multi-step execution planner
 * Uses LLM to intelligently detect and plan sequential task execution
 */

const prompts = require('../config/prompts');
const { generateTextResponse } = require('./geminiService');

/**
 * Use Gemini to intelligently plan multi-step execution
 * @param {string} userRequest - User's request text (without metadata)
 * @returns {Promise<Object>} - Planning result: {isMultiStep: boolean, steps: Array, reasoning: string}
 */
async function planMultiStepExecution(userRequest) {
  try {
    console.log(`🧠 [Planner] Analyzing request...`);
    
    const planningPrompt = prompts.multiStepPlanner(userRequest);
    
    const result = await generateTextResponse(planningPrompt, [], {
      model: 'gemini-2.0-flash-exp' // Fast model for planning
    });
    
    if (result.error) {
      console.warn(`⚠️ [Planner] Failed: ${result.error}`);
      return { isMultiStep: false, fallback: true };
    }
    
    // Parse JSON from response - clean and extract
    let jsonText = result.text.trim();
    
    // Remove markdown code blocks
    jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    // Extract JSON object (before removing ...)
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`⚠️ [Planner] No JSON found in response`);
      return { isMultiStep: false, fallback: true };
    }
    
    let jsonStr = jsonMatch[0];
    
    // Try to fix truncated JSON by Gemini
    // If JSON ends abruptly, try to complete it
    if (jsonStr.includes('...') || !jsonStr.match(/\}\s*$/)) {
      // Count open/close brackets
      const openBraces = (jsonStr.match(/\{/g) || []).length;
      const closeBraces = (jsonStr.match(/\}/g) || []).length;
      const openBrackets = (jsonStr.match(/\[/g) || []).length;
      const closeBrackets = (jsonStr.match(/\]/g) || []).length;
      
      // Close incomplete arrays
      if (openBrackets > closeBrackets) {
        jsonStr += ']';
      }
      
      // Close incomplete objects
      if (openBraces > closeBraces) {
        jsonStr += '}';
      }
      
      // Remove "..." artifacts
      jsonStr = jsonStr.replace(/\.\.\./g, '').replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']');
    } else {
      // No truncation, just clean
      jsonStr = jsonStr.replace(/\.\.\./g, '');
    }
    
    let plan;
    try {
      plan = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error(`❌ [Planner] JSON parse failed:`, parseError.message);
      console.log(`   Raw JSON (first 300 chars): ${jsonStr.substring(0, 300)}`);
      return { isMultiStep: false, fallback: true };
    }
    
    if (plan.isMultiStep && Array.isArray(plan.steps) && plan.steps.length > 1) {
      console.log(`✅ [Planner] Multi-step: ${plan.steps.length} steps`);
      plan.steps.forEach((step) => {
        console.log(`   📍 Step ${step.stepNumber}: ${step.action.substring(0, 60)}...`);
      });
      return plan;
    }
    
    console.log(`✅ [Planner] Single-step`);
    return { isMultiStep: false };
    
  } catch (error) {
    console.error(`❌ [Planner] Error:`, error.message);
    return { isMultiStep: false, fallback: true };
  }
}

module.exports = {
  planMultiStepExecution
};

