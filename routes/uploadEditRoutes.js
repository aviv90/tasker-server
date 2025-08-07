const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer();
const { v4: uuidv4 } = require('uuid');
const taskStore = require('../store/taskStore');
const geminiService = require('../services/geminiService');
const openaiService = require('../services/openaiService');
const fs = require('fs');
const path = require('path');

router.post('/upload-edit', upload.single('file'), async (req, res) => {
  console.log('Request body:', req.body);
  console.log('Request file:', req.file ? 'File present' : 'No file');
  
  const { prompt, provider } = req.body;
  if (!prompt || !req.file) {
    console.log('Missing:', { prompt: !!prompt, file: !!req.file });
    return res.status(400).json({ status:'error', error:'Missing prompt or file' });
  }

  const taskId = uuidv4();
  taskStore.set(taskId, { status:'pending' });
  res.json({ taskId });

  let result;
  if (provider === 'openai') {
    // For OpenAI, pass the buffer directly
    result = await openaiService.editImageWithText(prompt, req.file.buffer);
  } else {
    // For Gemini, convert to base64 as before
    const base64 = req.file.buffer.toString('base64');
    result = await geminiService.editImageWithText(prompt, base64);
  }
  
  finalize(taskId, result, req);
});

function finalize(taskId, result, req) {
  if (!result || result.error) {
    taskStore.set(taskId, { status:'error', error: result?.error || 'Unknown error' });
    return;
  }
  const filename = `${taskId}.png`;
  const outputDir = path.join(__dirname, '..', 'public', 'tmp');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive:true });
  fs.writeFileSync(path.join(outputDir, filename), result.imageBuffer);

  const host = `${req.protocol}://${req.get('host')}`;
  taskStore.set(taskId, {
    status:'done',
    result: `${host}/static/${filename}`,
    text: result.text
  });
}

module.exports = router;