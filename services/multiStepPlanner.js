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
    
    // Parse JSON from response
    let jsonText = result.text.trim()
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '');
    
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`⚠️ [Planner] No JSON found`);
      return { isMultiStep: false, fallback: true };
    }
    
    const plan = JSON.parse(jsonMatch[0]);
    
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

/**
 * Heuristic multi-step detection (fallback if planner fails)
 */
function detectMultiStepHeuristic(prompt) {
  if (!prompt) return false;
  
  const hasSequence = /(ואז|ואחר כך|אחר כך|and then|after that)/gi.test(prompt);
  const actionVerbs = prompt.match(/(ספר|כתוב|צור|תרגם|אמור|tell|write|create|translate|say)/gi);
  const hasMultipleActions = actionVerbs && actionVerbs.length >= 2;
  
  return hasSequence || hasMultipleActions;
}

module.exports = {
  planMultiStepExecution,
  detectMultiStepHeuristic
};

