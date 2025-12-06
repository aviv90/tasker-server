import { StepResult } from './multiStep';
import { isIntermediateToolOutputInPipeline } from '../utils/pipelineDetection';
import { cleanJsonWrapper } from '../../../utils/textSanitizer';

export function processFinalText(stepResults: StepResult[], options: any): string {
    const textParts: string[] = [];
    for (const stepResult of stepResults) {
        if (stepResult.text && stepResult.text.trim()) {
            // Get userText for pipeline detection
            const userText = options.input?.userText || '';

            // Only include text if it's not intermediate tool output in a pipeline
            const shouldSuppress = isIntermediateToolOutputInPipeline(stepResult, userText);
            if (!shouldSuppress) {
                textParts.push(stepResult.text.trim());
            }
        }
    }

    const finalText = cleanJsonWrapper(textParts.join('\n\n').trim());
    const lines = finalText.split('\n').filter(line => line.trim());
    const uniqueLines: string[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
        const normalized = line.trim().toLowerCase();
        if (!seen.has(normalized)) {
            seen.add(normalized);
            uniqueLines.push(line);
        }
    }
    return uniqueLines.join('\n').trim();
}
