import express, { Request, Response } from 'express';
import { expensiveOperationLimiter } from '../middleware/rateLimiter';
import * as taskStore from '../store/taskStore';
import { StartTaskSchema } from '../schemas/taskSchemas';
import { taskService } from '../services/taskService';
import logger from '../utils/logger';

const router = express.Router();

// Expensive operations (AI generation) - strict rate limiting
router.post('/start-task', expensiveOperationLimiter, async (req: Request, res: Response) => {
    try {
        // Validate request body with Zod
        const validationResult = StartTaskSchema.safeParse(req.body);

        if (!validationResult.success) {
            res.status(400).json({
                status: 'error',
                error: {
                    message: 'Validation failed',
                    details: validationResult.error.format(),
                    code: 'VALIDATION_ERROR'
                }
            });
            return;
        }

        const taskId = await taskService.startTask(validationResult.data, req);
        res.json({ taskId });

    } catch (error: any) {
        logger.error('❌ Error starting task:', { error: error.message || error.toString() });
        res.status(500).json({
            status: 'error',
            error: { message: 'Internal server error', code: 'INTERNAL_ERROR' }
        });
    }
});

router.get('/task-status/:taskId', async (req: Request, res: Response) => {
    if (!req.params.taskId) {
        res.status(400).json({ error: 'Missing taskId' });
        return;
    }
    const task = await taskStore.get(req.params.taskId);
    if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
    }
    res.json(task);
});

export default router;
