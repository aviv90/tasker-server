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
    console.log(`🚀 Starting ${type} task with ${provider || 'default'} provider - TaskID: ${taskId}`);
    taskStore.set(taskId, { status: 'pending' });
    res.json({ taskId });

    try {
        if (type === 'text-to-image') {
            let result;
            if (provider === 'openai') {
                console.log(`🎨 Generating image with OpenAI - TaskID: ${taskId}`);
                result = await openaiService.generateImageWithText(prompt);
            } else {
                console.log(`🎨 Generating image with Gemini - TaskID: ${taskId}`);
                result = await geminiService.generateImageWithText(prompt);
            }
            finalizeTask(taskId, result, req, 'png');
        } else if (type === 'text-to-video') {
            console.log(`🎬 Generating video with Runware - TaskID: ${taskId}`);
            const result = await runwareService.generateVideoWithText(prompt);
            // For videos, we return the URL directly instead of saving file
            if (result.error) {
                console.log(`❌ Video generation failed - TaskID: ${taskId}`);
                taskStore.set(taskId, { status: 'error', error: result.error });
            } else {
                console.log(`✅ Video generation completed - TaskID: ${taskId}`);
                taskStore.set(taskId, {
                    status: 'done',
                    result: result.videoURL,
                    text: result.text,
                    cost: result.cost
                });
            }
        } else {
            console.log(`❌ Unsupported task type: ${type} - TaskID: ${taskId}`);
            taskStore.set(taskId, { status: 'error', error: 'Unsupported task type' });
        }
    } catch (error) {
        console.error(`❌ Unexpected error in start-task - TaskID: ${taskId}:`, error.message);
        taskStore.set(taskId, { status: 'error', error: error.message || error.toString() || 'Unknown error occurred' });
    }
});

router.get('/task-status/:taskId', (req, res) => {
    const task = taskStore.get(req.params.taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
});

function finalizeTask(taskId, result, req, fileExtension = 'png') {
    try {
        if (!result || result.error) {
            console.log(`❌ Task finalization failed - TaskID: ${taskId}`);
            taskStore.set(taskId, { status: 'error', error: result?.error || result?.message || 'Task failed without error details' });
            return;
        }
        
        const filename = `${taskId}.${fileExtension}`;
        const outputDir = path.join(__dirname, '..', 'public', 'tmp');
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, filename);
        
        // Support both imageBuffer and videoBuffer
        const buffer = result.imageBuffer || result.videoBuffer;
        
        if (buffer) {
            fs.writeFileSync(outputPath, buffer);
            console.log(`✅ ${fileExtension.toUpperCase()} file saved - TaskID: ${taskId}`);
        } else {
            console.log(`❌ No buffer data - TaskID: ${taskId}`);
            taskStore.set(taskId, { status: 'error', error: 'No buffer data' });
            return;
        }

        const host = `${req.protocol}://${req.get('host')}`;
        console.log(`✅ Task completed successfully - TaskID: ${taskId}`);
        taskStore.set(taskId, {
            status: 'done',
            result: `${host}/static/${filename}`,
            text: result.text,
            cost: result.cost
        });
    } catch (error) {
        console.error(`❌ Error in finalizeTask function - TaskID: ${taskId}:`, error.message);
        taskStore.set(taskId, { status: 'error', error: error.message || error.toString() || 'Failed to save file' });
    }
}

module.exports = router;