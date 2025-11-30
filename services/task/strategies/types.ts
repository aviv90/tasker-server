import { StartTaskRequest } from '../../../schemas/taskSchemas';

export interface TaskStrategy {
    execute(taskId: string, request: StartTaskRequest, sanitizedPrompt: string, req: any): Promise<any>;
    finalize(taskId: string, result: any, req: any, prompt: string): Promise<void>;
}
