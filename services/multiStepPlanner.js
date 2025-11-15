const { GoogleGenerativeAI } = require('@google/generative-ai');
const prompts = require('../config/prompts');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Use LLM (Gemini) to plan multi-step execution
 * @param {string} userRequest - The user's request
 * @returns {Promise<{isMultiStep: boolean, steps?: Array, fallback?: boolean}>}
 */
async function planMultiStepExecution(userRequest) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
    
    const result = await model.generateContent(prompts.multiStepPlanner(userRequest));
    const response = result.response;
    
    if (!response || !response.text()) {
      console.warn(`⚠️ [Planner] No response from Gemini`);
      return { isMultiStep: false, fallback: true };
    }
    
    // Parse JSON from response - clean and extract
    let jsonText = response.text().trim();
    
    // Remove markdown code blocks
    jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    // Extract JSON object (before removing ...)
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`⚠️ [Planner] No JSON found in response`);
      return { isMultiStep: false, fallback: true };
    }
    
    let jsonStr = jsonMatch[0];
    
    // CRITICAL FIX: Gemini returns steps array without wrapping each step in {}
    // Bad:  "steps": [\n    "stepNumber": 1,\n    "tool": "x",\n    }\n  ]
    // Good: "steps": [\n    {\n      "stepNumber": 1,\n      "tool": "x"\n    }\n  ]
    
    // Simple detection and fix
    const stepsArrayPattern = /"steps"\s*:\s*\[[\s\n]*"stepNumber"/;
    if (stepsArrayPattern.test(jsonStr)) {
      console.log(`🔧 [Planner] Detected malformed steps array - fixing...`);
      
      // Add { after [ and before "stepNumber"
      jsonStr = jsonStr.replace(
        /"steps"\s*:\s*\[\s*/,
        '"steps": [\n    {'
      );
      
      // Add } before ]
      jsonStr = jsonStr.replace(
        /\s*\]\s*,?\s*"reasoning"/,
        '\n    }\n  ],\n  "reasoning"'
      );
      
      // If no reasoning, just close before final }
      if (!jsonStr.includes('"reasoning"')) {
        jsonStr = jsonStr.replace(/\s*\]\s*\}/, '\n    }\n  ]\n}');
      }
      
      console.log(`✅ [Planner] Fixed malformed steps array`);
    }
    
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
    
    // Final cleanup - remove trailing commas
    jsonStr = jsonStr.replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']');
    
    let plan;
    try {
      plan = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error(`❌ [Planner] JSON parse failed:`, parseError.message);
      console.log(`   Raw JSON (first 500 chars): ${jsonStr.substring(0, 500)}`);
      return { isMultiStep: false, fallback: true };
    }
    
    if (plan.isMultiStep && Array.isArray(plan.steps) && plan.steps.length > 1) {
      // Validate and normalize plan steps
      const validatedSteps = plan.steps.map((step, index) => {
        // Ensure step has required fields
        return {
          stepNumber: step.stepNumber || (index + 1),
          tool: step.tool || null,
          action: step.action || `Step ${index + 1}`,
          parameters: step.parameters || {}
        };
      });
      
      console.log(`✅ [Planner] Multi-step plan generated with ${validatedSteps.length} steps`);
      return {
        isMultiStep: true,
        steps: validatedSteps,
        reasoning: plan.reasoning
      };
    }
    
    console.log(`✅ [Planner] Single-step request detected`);
    return { isMultiStep: false };
    
  } catch (error) {
    console.error(`❌ [Planner] Error:`, error.message);
    return { isMultiStep: false, fallback: true };
  }
}

module.exports = {
  planMultiStepExecution
};
