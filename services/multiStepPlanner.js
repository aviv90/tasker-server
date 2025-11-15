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
    
    // CRITICAL: Fix malformed steps array BEFORE parsing
    // Pattern: "steps": [\n  "stepNumber": 1, ...  should be: "steps": [\n  { "stepNumber": 1, ...
    // This is the most common issue with Gemini's multi-step JSON responses
    console.log(`🔍 [Planner] Checking JSON for malformed steps array...`);
    const stepsMatch = jsonStr.match(/"steps"\s*:\s*\[\s*(.+?)\]/s);
    if (stepsMatch) {
      const stepsContent = stepsMatch[1];
      console.log(`🔍 [Planner] Steps content preview (first 200 chars): ${stepsContent.substring(0, 200)}`);
      
      // Check if steps array has malformed content (properties without object wrapper)
      // Look for: "stepNumber": 1, (without { before)
      if (stepsContent.includes('"stepNumber":') && !stepsContent.match(/^\s*\{/)) {
        console.log(`🔧 [Planner] Detected malformed steps array - fixing...`);
        
        // Find all stepNumber occurrences
        const stepNumberMatches = [...stepsContent.matchAll(/"stepNumber"\s*:\s*(\d+)/g)];
        console.log(`🔍 [Planner] Found ${stepNumberMatches.length} steps`);
        
        if (stepNumberMatches.length > 0) {
          const fixedSteps = [];
          
          for (let i = 0; i < stepNumberMatches.length; i++) {
            const match = stepNumberMatches[i];
            const startPos = match.index;
            const endPos = i < stepNumberMatches.length - 1 
              ? stepNumberMatches[i + 1].index 
              : stepsContent.length;
            
            // Extract content for this step
            let stepContent = stepsContent.substring(startPos, endPos).trim();
            
            // Remove trailing comma if exists
            stepContent = stepContent.replace(/,\s*$/, '');
            
            // Wrap in object
            fixedSteps.push(`    {\n      ${stepContent}\n    }`);
          }
          
          // Replace the malformed steps array
          jsonStr = jsonStr.replace(
            /"steps"\s*:\s*\[\s*.+?\]/s,
            `"steps": [\n${fixedSteps.join(',\n')}\n  ]`
          );
          
          console.log(`✅ [Planner] Fixed steps array - wrapped ${fixedSteps.length} steps in objects`);
        }
      } else {
        console.log(`✅ [Planner] Steps array is well-formed`);
      }
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
      const errorPos = parseInt(parseError.message.match(/position (\d+)/)?.[1] || '0');
      console.log(`   Error position: ${errorPos}`);
      console.log(`   Raw JSON (full): ${jsonStr}`);
      if (errorPos > 0) {
        console.log(`   Context around error (position ${Math.max(0, errorPos-50)}-${errorPos+50}):`);
        console.log(`   ${jsonStr.substring(Math.max(0, errorPos-50), errorPos+50)}`);
      }
      
      // Try more aggressive JSON fixes
      // 1. Fix trailing commas
      jsonStr = jsonStr.replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']');
      
      // 2. Fix malformed steps array by wrapping each step in object
      // Look for pattern: "steps": [\n    "stepNumber": 1,\n    ... (no { before)
      jsonStr = jsonStr.replace(
        /"steps"\s*:\s*\[\s*"stepNumber"\s*:/g,
        '"steps": [\n    {\n      "stepNumber":'
      );
      
      // 3. Close any unclosed objects before next stepNumber or end of array
      jsonStr = jsonStr.replace(/([^}])\s*"stepNumber"\s*:/g, '$1\n    }\n    {\n      "stepNumber":');
      jsonStr = jsonStr.replace(/"steps"\s*:\s*\[([^\]]+)\]/g, (match, content) => {
        if (!content.includes('{') && content.includes('"stepNumber":')) {
          // Wrap the entire content in object
          return `"steps": [{\n${content.replace(/^/, '    ')}\n  }]`;
        }
        return match;
      });
      
      // Try parsing again after fixes
      try {
        plan = JSON.parse(jsonStr);
        console.log(`✅ [Planner] JSON fixed and parsed successfully`);
      } catch (retryError) {
        console.error(`❌ [Planner] Still failed after fix:`, retryError.message);
        console.log(`   Fixed JSON (first 1000 chars): ${jsonStr.substring(0, 1000)}`);
        return { isMultiStep: false, fallback: true };
      }
    }
    
    if (plan.isMultiStep && Array.isArray(plan.steps) && plan.steps.length > 1) {
      // Validate and normalize plan steps
      const validatedSteps = plan.steps.map((step, index) => {
        // Ensure step has required fields
        return {
          stepNumber: step.stepNumber || index + 1,
          tool: step.tool || null, // null if text-only step
          action: step.action || `Step ${index + 1}`,
          parameters: step.parameters || {}
        };
      });
      
      return {
        ...plan,
        steps: validatedSteps
      };
    }
    
    return { isMultiStep: false };
    
  } catch (error) {
    console.error(`❌ [Planner] Error:`, error.message);
    return { isMultiStep: false, fallback: true };
  }
}

module.exports = {
  planMultiStepExecution
};

