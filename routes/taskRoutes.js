const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const taskStore = require('../store/taskStore');
const geminiService = require('../services/geminiService');
const openaiService = require('../services/openaiService');
const runwareService = require('../services/runwareService');
const replicateService = require('../services/replicateService');
const fs = require('fs');
const path = require('path');

router.post('/start-task', async (req, res) => {
    const { type, prompt, provider } = req.body;
    if (!type || !prompt) return res.status(400).json({ status: 'error', error: 'Missing type or prompt' });

    const taskId = uuidv4();
    console.log(`🚀 Starting ${type} task with ${provider || 'default'} provider`);
    taskStore.set(taskId, { status: 'pending' });
    res.json({ taskId });

    try {
        if (type === 'text-to-image') {
            let result;
            if (provider === 'openai') {
                result = await openaiService.generateImageWithText(prompt);
            } else {
                result = await geminiService.generateImageWithText(prompt);
            }
            finalizeTask(taskId, result, req, 'png');
        } else if (type === 'text-to-video') {
            let result;
            if (provider === 'replicate') {
                result = await replicateService.generateVideoWithText(prompt);
            } else {
                result = await runwareService.generateVideoWithText(prompt);
            }
            
            finalizeVideo(taskId, result, prompt);
        } else {
            taskStore.set(taskId, { status: 'error', error: 'Unsupported task type' });
        }
    } catch (error) {
        console.error(`❌ Task error:`, error.message);
        taskStore.set(taskId, { status: 'error', error: error.message || 'Unknown error occurred' });
    }
});

router.get('/task-status/:taskId', (req, res) => {
    const task = taskStore.get(req.params.taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
});

function finalizeVideo(taskId, result, prompt) {
    try {
        if (!result || result.error) {
            taskStore.set(taskId, { status: 'error', error: result?.error || 'Task failed without error details' });
            return;
        }

        console.log(`✅ Video generation completed`);
        taskStore.set(taskId, {
            status: 'done',
            result: result.result,
            text: result.text || prompt,
            cost: result.cost
        });
    } catch (error) {
        console.error(`❌ Error in finalizeVideo:`, error.message);
        taskStore.set(taskId, { status: 'error', error: error.message || 'Failed to finalize video' });
    }
}

function finalizeTask(taskId, result, req, fileExtension = 'png') {
    try {
        if (!result || result.error) {
            taskStore.set(taskId, { status: 'error', error: result?.error || 'Task failed without error details' });
            return;
        }
        
        const filename = `${taskId}.${fileExtension}`;
        const outputDir = path.join(__dirname, '..', 'public', 'tmp');
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, filename);
        
        const buffer = result.imageBuffer || result.videoBuffer;
        
        if (buffer) {
            fs.writeFileSync(outputPath, buffer);
            console.log(`✅ ${fileExtension.toUpperCase()} file saved`);
        } else {
            taskStore.set(taskId, { status: 'error', error: 'No buffer data' });
            return;
        }

        const host = `${req.protocol}://${req.get('host')}`;
        console.log(`✅ Task completed successfully`);
        taskStore.set(taskId, {
            status: 'done',
            result: `${host}/static/${filename}`,
            text: result.text,
            cost: result.cost
        });
    } catch (error) {
        console.error(`❌ Error in finalizeTask:`, error.message);
        taskStore.set(taskId, { status: 'error', error: error.message || 'Failed to save file' });
    }
}

module.exports = router;