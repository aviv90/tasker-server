const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const taskStore = require('../store/taskStore');
const geminiService = require('../services/geminiService');
const fs = require('fs');
const path = require('path');

router.post('/start-task', async (req, res) => {
    const { type, prompt } = req.body;
    if (!type || !prompt) return res.status(400).json({ status: 'error', error: 'Missing type or prompt' });

    const taskId = uuidv4();
    taskStore.set(taskId, { status: 'pending' });
    res.json({ taskId });

    if (type === 'text-to-image') {
        const result = await geminiService.generateImageWithText(prompt);
        finalizeTask(taskId, result, req);
    } else {
        taskStore.set(taskId, { status: 'error', error: 'Unsupported task type' });
    }
});

router.get('/task-status/:taskId', (req, res) => {
    const task = taskStore.get(req.params.taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
});

function finalizeTask(taskId, result, req) {
    if (!result || result.error) {
        taskStore.set(taskId, { status: 'error', error: result?.error || 'Unknown error' });
        return;
    }
    const filename = `${taskId}.png`;
    const outputDir = path.join(__dirname, '..', 'public', 'tmp');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, filename);
    fs.writeFileSync(outputPath, result.imageBuffer);

    const host = `${req.protocol}://${req.get('host')}`;
    taskStore.set(taskId, {
        status: 'done',
        result: `${host}/static/${filename}`,
        text: result.text
    });
}

module.exports = router;