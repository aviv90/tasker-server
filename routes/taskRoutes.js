const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const taskStore = require('../store/taskStore');
const geminiService = require('../services/geminiService');
const openaiService = require('../services/openaiService');
const runwareService = require('../services/runwareService');
const fs = require('fs');
const path = require('path');

router.post('/start-task', async (req, res) => {
    const { type, prompt, provider } = req.body;
    if (!type || !prompt) return res.status(400).json({ status: 'error', error: 'Missing type or prompt' });

    const taskId = uuidv4();
    taskStore.set(taskId, { status: 'pending' });
    res.json({ taskId });

    if (type === 'text-to-image') {
        let result;
        if (provider === 'openai') {
            result = await openaiService.generateImageWithText(prompt);
        } else {
            // Default to Gemini
            result = await geminiService.generateImageWithText(prompt);
        }
        finalizeTask(taskId, result, req, 'png');
    } else if (type === 'text-to-video') {
        // Text to Video only supports Runware for now
        const result = await runwareService.generateVideoWithText(prompt);
        // For videos, we return the URL directly instead of saving file
        if (result.error) {
            taskStore.set(taskId, { status: 'error', error: result.error });
        } else {
            taskStore.set(taskId, {
                status: 'done',
                result: result.videoURL,
                text: result.text,
                cost: result.cost
            });
        }
    } else {
        taskStore.set(taskId, { status: 'error', error: 'Unsupported task type' });
    }
});

router.get('/task-status/:taskId', (req, res) => {
    const task = taskStore.get(req.params.taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
});

function finalizeTask(taskId, result, req, fileExtension = 'png') {
    if (!result || result.error) {
        taskStore.set(taskId, { status: 'error', error: result?.error || 'Unknown error' });
        return;
    }
    
    const filename = `${taskId}.${fileExtension}`;
    const outputDir = path.join(__dirname, '..', 'public', 'tmp');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, filename);
    
    // Support both imageBuffer and videoBuffer
    const buffer = result.imageBuffer || result.videoBuffer;
    
    if (buffer) {
        try {
            fs.writeFileSync(outputPath, buffer);
            console.log(`✅ ${fileExtension.toUpperCase()} file saved: ${filename}`);
        } catch (writeError) {
            console.error('❌ Error writing file:', writeError);
            taskStore.set(taskId, { status: 'error', error: 'Failed to write file' });
            return;
        }
    } else {
        taskStore.set(taskId, { status: 'error', error: 'No buffer data' });
        return;
    }

    const host = `${req.protocol}://${req.get('host')}`;
    taskStore.set(taskId, {
        status: 'done',
        result: `${host}/static/${filename}`,
        text: result.text,
        cost: result.cost
    });
}

module.exports = router;