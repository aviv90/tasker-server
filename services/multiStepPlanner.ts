/**
 * Multi-step execution planner using LLM (Gemini)
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import prompts from '../config/prompts';
import logger from '../utils/logger';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Step in multi-step plan
 */
interface PlanStep {
  stepNumber: number;
  tool: string | null;
  action: string;
  parameters: Record<string, unknown>;
}

/**
 * Multi-step plan result
 */
interface MultiStepPlan {
  isMultiStep: boolean;
  steps?: PlanStep[];
  reasoning?: string;
  fallback?: boolean;
}

/**
 * Use LLM (Gemini) to plan multi-step execution
 * @param userRequest - The user's request
 * @returns Plan result with steps if multi-step, or single-step indication
 */
export async function planMultiStepExecution(userRequest: string): Promise<MultiStepPlan> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3-pro-preview' });
    
    const result = await model.generateContent(prompts.multiStepPlanner(userRequest));
    const response = result.response;
    
    if (!response || !response.text()) {
      logger.warn(`⚠️ [Planner] No response from Gemini`);
      return { isMultiStep: false, fallback: true };
    }
    
    // Parse JSON from response - clean and extract
    let jsonText = response.text().trim();
    
    // Remove markdown code blocks
    jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    // Extract JSON object (before removing ...)
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn(`⚠️ [Planner] No JSON found in response`);
      return { isMultiStep: false, fallback: true };
    }
    
    let jsonStr = jsonMatch[0];
    
    // CRITICAL FIX: Gemini returns steps array without wrapping each step in {}
    // Bad:  "steps": [\n    "stepNumber": 1,\n    "tool": "x",\n    }\n  ]
    // Good: "steps": [\n    {\n      "stepNumber": 1,\n      "tool": "x"\n    }\n  ]
    
    // Simple detection and fix
    const stepsArrayPattern = /"steps"\s*:\s*\[[\s\n]*"stepNumber"/;
    if (stepsArrayPattern.test(jsonStr)) {
      logger.debug(`🔧 [Planner] Detected malformed steps array - fixing...`);
      
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
      
      logger.debug(`✅ [Planner] Fixed malformed steps array`);
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
    
    let plan: { isMultiStep?: boolean; steps?: unknown[]; reasoning?: string };
    try {
      plan = JSON.parse(jsonStr) as { isMultiStep?: boolean; steps?: unknown[]; reasoning?: string };
    } catch (parseError: unknown) {
      const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
      logger.error(`❌ [Planner] JSON parse failed:`, { error: errorMessage, rawJson: jsonStr.substring(0, 500) });
      return { isMultiStep: false, fallback: true };
    }
    
    if (plan.isMultiStep && Array.isArray(plan.steps) && plan.steps.length > 1) {
      // Validate and normalize plan steps
      const validatedSteps: PlanStep[] = plan.steps.map((step: unknown, index: number) => {
        const stepObj = step as Partial<PlanStep>;
        // Ensure step has required fields
        return {
          stepNumber: stepObj.stepNumber || (index + 1),
          tool: stepObj.tool || null,
          action: stepObj.action || `Step ${index + 1}`,
          parameters: (stepObj.parameters as Record<string, unknown>) || {}
        };
      });
      
      logger.info(`✅ [Planner] Multi-step plan generated with ${validatedSteps.length} steps`);
      return {
        isMultiStep: true,
        steps: validatedSteps,
        reasoning: plan.reasoning
      };
    }
    
    logger.debug(`✅ [Planner] Single-step request detected`);
    return { isMultiStep: false };
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`❌ [Planner] Error:`, { error: errorMessage, stack: error instanceof Error ? error.stack : undefined });
    return { isMultiStep: false, fallback: true };
  }
}

