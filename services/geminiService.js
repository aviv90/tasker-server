const { GoogleGenerativeAI, GenerateContentConfig } = require('@google/generative-ai');
const genai = require('@google/genai');
const { sanitizeText } = require('../utils/textSanitizer');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const veoClient = new genai.GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

async function generateImageWithText(prompt) {
    try {
        console.log('🎨 Starting Gemini image generation');
        
        // Sanitize prompt as an extra safety measure
        const cleanPrompt = sanitizeText(prompt);
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash-image-preview" 
        });
        
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: cleanPrompt }] }],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
        });
        
        const response = result.response;
        if (!response.candidates || response.candidates.length === 0) {
            console.log('❌ Gemini: No candidates returned');
            return { error: response.promptFeedback?.blockReasonMessage || 'No candidate returned' };
        }
        
        const cand = response.candidates[0];
        let text = '';
        let imageBuffer = null;
        
        // Process all parts in the response
        for (const part of cand.content.parts) {
            if (part.text) {
                text += part.text;
            } else if (part.inlineData?.data) {
                imageBuffer = Buffer.from(part.inlineData.data, 'base64');
            }
        }
        
        if (!imageBuffer) {
            console.log('❌ Gemini: No image data found in response');
            return { error: { message: 'No image data found in response', code: 'NO_IMAGE_DATA', provider: 'gemini' } };
        }
        
        console.log('✅ Gemini image generated successfully');
        return { text: text || prompt, imageBuffer };
    } catch (err) {
        console.error('❌ Gemini image generation error:', err);
        // Throw the error so it gets caught by the route's catch block
        throw err;
    }
}

async function editImageWithText(prompt, base64Image) {
    try {
        console.log('🖼️ Starting Gemini image editing');
        
        // Sanitize prompt as an extra safety measure
        const cleanPrompt = sanitizeText(prompt);
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash-image-preview" 
        });
        
        const result = await model.generateContent({
            contents: [
                { role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: base64Image } }, { text: cleanPrompt }] }
            ],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
        });
        
        const response = result.response;
        if (!response.candidates || response.candidates.length === 0) {
            console.log('❌ Gemini edit: No candidates returned');
            return { error: response.promptFeedback?.blockReasonMessage || 'No candidate returned' };
        }
        
        const cand = response.candidates[0];
        let text = '';
        let imageBuffer = null;
        
        // Process all parts in the response
        for (const part of cand.content.parts) {
            if (part.text) {
                text += part.text;
            } else if (part.inlineData?.data) {
                imageBuffer = Buffer.from(part.inlineData.data, 'base64');
            }
        }
        
        if (!imageBuffer) {
            console.log('❌ Gemini edit: No image data found in response');
            return { error: { message: 'No image data found in response', code: 'NO_IMAGE_DATA', provider: 'gemini-edit' } };
        }
        
        console.log('✅ Gemini image edited successfully');
        return { text: text || prompt, imageBuffer };
    } catch (err) {
        console.error('❌ Gemini image edit error:', err);
        // Throw the error so it gets caught by the route's catch block
        throw err;
    }
}

async function generateVideoWithText(prompt) {
    const requestId = Math.random().toString(36).substr(2, 9);
    console.log(`🎬 Starting Veo 3 text-to-video generation [${requestId}]`);
    try {
        const cleanPrompt = sanitizeText(prompt);
        const model = 'veo-3.0-generate-preview';
        const aspectRatio = '16:9'; // Veo 3 currently supports 16:9 (docs)
        const personGeneration = 'allow_all';

        // --- 1. Start operation (doc: models.generateVideo) ---
        const request = {
            model,
            prompt: cleanPrompt,
            aspectRatio,
            personGeneration
        };
        console.log(`🛠️ Veo request [${requestId}] -> model: ${model}, aspect: ${aspectRatio}, personGeneration: ${personGeneration}`);

        let op;
        try {
            if (typeof veoClient?.models?.generateVideo === 'function') {
                op = await veoClient.models.generateVideo(request);
            } else if (typeof veoClient?.models?.generateVideos === 'function') {
                // Fallback in case SDK version still exposes plural form
                op = await veoClient.models.generateVideos(request);
            } else {
                return { error: { message: 'generateVideo API not available in installed @google/genai version', code: 'NO_GENERATE_VIDEO', provider: 'gemini-veo' } };
            }
        } catch (startErr) {
            // Surface detailed INVALID_ARGUMENT hints
            const msg = startErr?.message || '';
            if (startErr?.status === 400) {
                console.error('❌ Veo start error 400 INVALID_ARGUMENT:', msg);
                return { error: { message: msg, code: 'INVALID_ARGUMENT', provider: 'gemini-veo', hint: 'Check model access, aspectRatio, or restricted prompt content.' } };
            }
            throw startErr;
        }

        const opName = op?.name || op?.operation?.name;
        if (!opName) {
            return { error: { message: 'Missing operation name from Veo response', code: 'NO_OPERATION_NAME', provider: 'gemini-veo', raw: Object.keys(op || {}) } };
        }
        console.log(`⏳ Received operation name [${requestId}]:`, opName);

        // --- 2. Poll operation ---
        const maxMs = 10 * 60 * 1000; // 10 minutes
        const start = Date.now();
        let delay = 8000; // initial 8s
        let pollCount = 0;
        let operation = op; // Start with initial operation

        while (!operation?.done) {
            pollCount++;
            if (Date.now() - start > maxMs) {
                return { error: { message: 'Video generation timed out after 10 minutes', code: 'TIMEOUT', provider: 'gemini-veo' } };
            }
            
            // Wait before polling
            await new Promise(r => setTimeout(r, delay));
            
            try {
                // Use the correct API method from docs: getVideosOperation with operation object
                if (veoClient?.operations?.getVideosOperation) {
                    operation = await veoClient.operations.getVideosOperation({
                        operation: operation,
                    });
                } else {
                    return { error: { message: 'getVideosOperation API not available in SDK version', code: 'NO_GET_VIDEOS_OPERATION', provider: 'gemini-veo' } };
                }
                
            } catch (pollErr) {
                console.error(`⚠️ Poll ${pollCount} fetch error:`, pollErr?.message || pollErr);
                // Continue polling on error
                continue;
            }

            if (operation?.error) {
                console.error('❌ Veo operation error object:', operation.error);
                const opErrMsg = operation.error?.message || JSON.stringify(operation.error);
                return { error: { message: opErrMsg, code: operation.error?.code || 'OPERATION_ERROR', provider: 'gemini-veo' } };
            }

            // Adaptive backoff
            if (pollCount === 5) delay = 12000; // after ~1 min
            if (pollCount === 15) delay = 20000; // later stage
            
            if (operation?.done) {
                console.log(`✅ Veo operation done after ${pollCount} polls [${requestId}]`);
            } else {
                console.log(`🔄 Poll ${pollCount} - still processing [${requestId}]`);
            }
        }

        // --- 3. Extract video references ---
        const resp = operation?.response || {};
        // Per docs: should be generatedVideos (not generated_videos)
        const videosArray = resp.generatedVideos || resp.generated_videos || resp.videos || [];
        let primaryVideo = null;
        if (Array.isArray(videosArray) && videosArray.length) {
            primaryVideo = videosArray[0];
        }

        if (!primaryVideo) {
            return { error: { message: 'No video reference returned from Veo', code: 'NO_VIDEO', provider: 'gemini-veo', rawKeys: Object.keys(resp || {}) } };
        }

        // --- 4. Download video bytes ---
        let rawBuffer;
        try {
            console.log(`📥 Starting video download [${requestId}]...`);
            console.log(`📥 Primary video object keys [${requestId}]:`, Object.keys(primaryVideo || {}));
            console.log(`📥 Video file reference [${requestId}]:`, primaryVideo.video);
            
            // Extract file ID from URI (last part before :download)
            const videoUri = primaryVideo.video?.uri;
            if (!videoUri) {
                return { error: { message: 'No video URI found in response', code: 'NO_VIDEO_URI', provider: 'gemini-veo', videoObj: primaryVideo.video } };
            }
            
            // Extract file ID from URI like: .../files/f9p0s09wfdvb:download?alt=media
            const fileIdMatch = videoUri.match(/\/files\/([^:]+):/);
            const fileId = fileIdMatch ? fileIdMatch[1] : null;
            
            if (!fileId) {
                return { error: { message: 'Could not extract file ID from URI', code: 'NO_FILE_ID', provider: 'gemini-veo', uri: videoUri } };
            }
            
            console.log(`📥 Extracted file ID [${requestId}]:`, fileId);
            
            // Try multiple SDK download methods
            if (veoClient?.files?.download) {
                console.log(`📥 Using SDK download method [${requestId}]...`);
                
                // Try different signatures for download
                try {
                    // Method 1: Object with file property
                    rawBuffer = await veoClient.files.download({ file: fileId });
                    console.log(`📥 Method 1 result [${requestId}]:`, typeof rawBuffer, rawBuffer?.length);
                    if (!rawBuffer) {
                        throw new Error('Method 1 returned undefined/null');
                    }
                } catch (err1) {
                    console.log(`📥 Method 1 failed [${requestId}]:`, err1?.message);
                    try {
                        // Method 2: Direct file ID
                        rawBuffer = await veoClient.files.download(fileId);
                        console.log(`📥 Method 2 result [${requestId}]:`, typeof rawBuffer, rawBuffer?.length);
                        if (!rawBuffer) {
                            throw new Error('Method 2 returned undefined/null');
                        }
                    } catch (err2) {
                        console.log(`📥 Method 2 failed [${requestId}]:`, err2?.message);
                        try {
                            // Method 3: Full URI as file reference
                            rawBuffer = await veoClient.files.download({ file: videoUri });
                            console.log(`📥 Method 3 result [${requestId}]:`, typeof rawBuffer, rawBuffer?.length);
                            if (!rawBuffer) {
                                throw new Error('Method 3 returned undefined/null');
                            }
                        } catch (err3) {
                            console.log(`📥 Method 3 failed [${requestId}]:`, err3?.message);
                            try {
                                // Method 4: Files prefix
                                rawBuffer = await veoClient.files.download({ file: `files/${fileId}` });
                                console.log(`📥 Method 4 result [${requestId}]:`, typeof rawBuffer, rawBuffer?.length);
                                if (!rawBuffer) {
                                    throw new Error('Method 4 returned undefined/null');
                                }
                            } catch (err4) {
                                console.log(`📥 All SDK methods failed [${requestId}]`);
                                console.log(`📥 Falling back to direct HTTP with proper auth [${requestId}]...`);
                                
                                // Final fallback: direct HTTP with API key in URL
                                const https = require('https');
                                
                                try {
                                    const downloadUrl = `${videoUri}&key=${process.env.GEMINI_API_KEY}`;
                                    console.log(`📥 Trying direct HTTP download [${requestId}]...`);
                                    
                                    rawBuffer = await new Promise((resolve, reject) => {
                                        const urlObj = new URL(downloadUrl);
                                        const options = {
                                            hostname: urlObj.hostname,
                                            path: urlObj.pathname + urlObj.search,
                                            timeout: 30000
                                        };
                                        
                                        const req = https.get(options, (res) => {
                                            console.log(`📥 HTTP response status [${requestId}]:`, res.statusCode);
                                            
                                            // Handle redirects (302, 301, etc.)
                                            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                                                console.log(`📥 Following redirect [${requestId}]:`, res.headers.location);
                                                res.resume(); // consume response to free up memory
                                                
                                                // Follow redirect
                                                const redirectUrl = new URL(res.headers.location);
                                                const redirectOptions = {
                                                    hostname: redirectUrl.hostname,
                                                    path: redirectUrl.pathname + redirectUrl.search,
                                                    timeout: 30000
                                                };
                                                
                                                const redirectReq = https.get(redirectOptions, (redirectRes) => {
                                                    console.log(`📥 Redirect response status [${requestId}]:`, redirectRes.statusCode);
                                                    if (redirectRes.statusCode !== 200) {
                                                        reject(new Error(`Redirect HTTP ${redirectRes.statusCode}: ${redirectRes.statusMessage}`));
                                                        return;
                                                    }
                                                    
                                                    const chunks = [];
                                                    redirectRes.on('data', chunk => {
                                                        chunks.push(chunk);
                                                        if (chunks.length % 100 === 0) {
                                                            console.log(`📥 Downloaded chunks [${requestId}]:`, chunks.length);
                                                        }
                                                    });
                                                    redirectRes.on('end', () => {
                                                        const buffer = Buffer.concat(chunks);
                                                        console.log(`📥 HTTP download success [${requestId}]:`, buffer.length, 'bytes');
                                                        resolve(buffer);
                                                    });
                                                    redirectRes.on('error', reject);
                                                });
                                                
                                                redirectReq.on('error', reject);
                                                redirectReq.on('timeout', () => {
                                                    redirectReq.destroy();
                                                    reject(new Error('Redirect download timeout after 30s'));
                                                });
                                                return;
                                            }
                                            
                                            if (res.statusCode !== 200) {
                                                reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                                                return;
                                            }
                                            
                                            const chunks = [];
                                            res.on('data', chunk => {
                                                chunks.push(chunk);
                                                if (chunks.length % 100 === 0) { // Log every 100 chunks
                                                    console.log(`📥 Downloaded chunks [${requestId}]:`, chunks.length);
                                                }
                                            });
                                            res.on('end', () => {
                                                const buffer = Buffer.concat(chunks);
                                                console.log(`📥 HTTP download success [${requestId}]:`, buffer.length, 'bytes');
                                                resolve(buffer);
                                            });
                                            res.on('error', reject);
                                        });
                                        req.on('error', reject);
                                        req.on('timeout', () => {
                                            req.destroy();
                                            reject(new Error('HTTP download timeout after 30s'));
                                        });
                                    });
                                } catch (httpErr) {
                                    return { error: { 
                                        message: 'All download methods failed including HTTP fallback', 
                                        code: 'ALL_DOWNLOAD_FAILED', 
                                        provider: 'gemini-veo',
                                        sdkAttempts: [err1?.message, err2?.message, err3?.message, err4?.message],
                                        httpError: httpErr?.message
                                    }};
                                }
                            }
                        }
                    }
                }
            } else {
                return { error: { message: 'files.download method not available in SDK', code: 'NO_DOWNLOAD_METHOD', provider: 'gemini-veo' } };
            }
            
            console.log(`📥 Download result [${requestId}] - type:`, typeof rawBuffer, 'length:', rawBuffer?.length || 'N/A');
            
        } catch (dlErr) {
            console.error(`❌ Veo download error [${requestId}]:`, dlErr?.message || dlErr);
            return { error: { message: dlErr?.message || 'Video download failed', code: 'DOWNLOAD_FAILED', provider: 'gemini-veo' } };
        }

        if (!rawBuffer || rawBuffer.length === 0) {
            console.error(`❌ Empty or null buffer received from download [${requestId}]`);
            return { error: { message: 'Empty video buffer returned', code: 'EMPTY_BUFFER', provider: 'gemini-veo', bufferInfo: { type: typeof rawBuffer, length: rawBuffer?.length } } };
        }

        console.log(`✅ Veo text-to-video generated & downloaded successfully [${requestId}]`);
        return {
            text: cleanPrompt,
            videoBuffer: Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer),
            model,
            aspectRatio
        };
    } catch (err) {
        if (err?.status === 400) {
            console.error(`❌ Veo text-to-video generation error 400 INVALID_ARGUMENT [${requestId}]:`, err.message || err);
        } else {
            console.error(`❌ Veo text-to-video generation error [${requestId}]:`, err);
        }
        throw err;
    }
}

module.exports = { generateImageWithText, editImageWithText, generateVideoWithText };