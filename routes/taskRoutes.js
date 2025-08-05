const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const taskStore = require('../store/taskStore');
const geminiService = require('../services/geminiService');
const fs = require('fs');
const path = require('path');

// Start task
router.post('/start-task', async (req, res) => {
    const { type, prompt } = req.body;
    if (!type || !prompt) return res.status(400).json({ error: 'Missing type or prompt' });

    const taskId = uuidv4();
    taskStore.set(taskId, { status: 'pending' });

    handleTask(taskId, type, prompt, req);

    res.json({ taskId });
});

// Polling
router.get('/task-status/:taskId', (req, res) => {
    const task = taskStore.get(req.params.taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
});

async function handleTask(taskId, type, prompt, req) {
    try {
        if (type === 'text-to-image') {

            const result = await geminiService.generateImageWithText(prompt);

            if (!result || result.error) {
                taskStore.set(taskId, {
                    status: 'error',
                    error: result?.error || 'Unknown error from Gemini'
                });
                return;
            }

            const { text, imageBuffer } = result;

            const filename = `${taskId}.png`;
            const outputDir = path.join(__dirname, '..', 'public', 'tmp');
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            const outputPath = path.join(outputDir, filename);
            fs.writeFileSync(outputPath, imageBuffer);

            const host = `${req.protocol}://${req.get('host')}`;
            taskStore.set(taskId, {
                status: 'done',
                result: `${host}/static/${filename}`,
                text
            });

        } else {
            taskStore.set(taskId, { status: 'error', error: 'Unsupported task type' });
        }
    } catch (err) {
        taskStore.set(taskId, { status: 'error', error: err.message });
    }
}

module.exports = router;