# Tasker Server

## 🚀 AI Content Generation API

A powerful Node.js server providing unified access to multiple AI providers for image and video generation.

## 🎯 Features

### 🎨 Image Generation
- **Text-to-Image**: Generate images from text prompts
- **Image Editing**: Edit existing images with AI

### 🎬 Video Generation  
- **Text-to-Video**: Create videos from text descriptions
- **Image-to-Video**: Animate static images into videos
- **HD Video Support**: 1080p high-definition videos

### 🎤 Audio Processing
- **Audio Transcription**: Convert speech to text with Lemonfox API
- **ElevenLabs Speech-to-Text**: High-quality multilingual speech recognition with advanced options

### 🎵 Music Generation
- **Text-to-Music**: Generate music with lyrics from text prompts
- **Instrumental Music**: Create background music and soundtracks
- **Multiple Models**: Suno V3.5, V4, V4.5, V4.5Plus for different quality levels

## 🔌 Supported Providers

### **🥇 Kie.ai** (All-in-One Platform)
- **Models**: Veo 3, Veo 3 Fast, Runway Aleph, Luma Dream Machine
- **Features**: HD videos, fast generation, affordable pricing
- **API**: `provider=kie&model=veo3|veo3_fast`

### **🎬 Google Gemini**
- **Models**: Veo 3, Gemini 2.5 Flash Image
- **Features**: Native audio, 720p videos, 8-second duration
- **API**: `provider=gemini`

### **⚡ Replicate**
- **Models**: Kling v2.1 Master, Veo 3, Runway Gen-4 Aleph
- **Features**: Wide model selection, reliable performance
- **API**: `provider=replicate&model=kling-v2.1|veo3|runway-gen4`

### **🤖 OpenAI**
- **Models**: DALL-E 3
- **Features**: High-quality image generation and editing
- **API**: `provider=openai`

### **🎤 ElevenLabs**
- **Models**: Scribe v1, Scribe v1 Experimental
- **Features**: Advanced speech recognition, noise removal, filler word removal
- **API**: `provider=elevenlabs&model=scribe_v1`

## 📡 API Endpoints

### Text-to-Video
```bash
POST /api/start-task
Content-Type: application/json

{
  "type": "text-to-video",
  "prompt": "A cute cat playing in a garden",
  "provider": "kie",
  "model": "veo3"
}
```

### Image-to-Video
```bash
POST /api/upload-video
Content-Type: multipart/form-data

file: [image file]
prompt: "Make the person wave and smile"
provider: "kie"
model: "veo3"
```

### Text-to-Image
```bash
POST /api/start-task
Content-Type: application/json

{
  "type": "text-to-image", 
  "prompt": "A beautiful sunset over mountains",
  "provider": "gemini"
}
```

### Text-to-Music
```bash
POST /api/start-task
Content-Type: application/json

{
  "type": "text-to-music",
  "prompt": "A happy song about summer vacation and good times with friends",
  "model": "V4_5"
}
```

### Audio Transcription (Lemonfox)
```bash
POST /api/upload-transcribe
Content-Type: multipart/form-data

file: [audio file]
```

### Audio Transcription (ElevenLabs)
```bash
POST /api/upload-transcribe
Content-Type: multipart/form-data

file: [audio file]
provider: "elevenlabs"
model: "scribe_v1"
language: "auto"
removeNoise: "true"
removeFiller: "true"
```

### Instrumental Music
```bash
POST /api/start-task
Content-Type: application/json

{
  "type": "text-to-music",
  "prompt": "Relaxing ambient background music for studying",
  "instrumental": true,
  "model": "V4_5"
}
```

### Task Status
```bash
GET /api/task-status/:taskId
```

## 🛠️ Setup

1. **Clone repository**
```bash
git clone <repository-url>
cd tasker-server
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment variables**
```bash
cp .env.example .env
# Edit .env with your API keys
```

4. **Required API Keys**
```bash
GEMINI_API_KEY=your_gemini_key
OPENAI_API_KEY=your_openai_key  
REPLICATE_API_KEY=your_replicate_key
KIE_API_KEY=your_kie_api_key
ELEVEN_API_KEY=your_elevenlabs_key
```

5. **Start server**
```bash
npm start
```

## 🎯 Model Recommendations

### **For Maximum Quality**
- **Video**: `provider=kie&model=veo3` (HD 1080p with audio)
- **Image**: `provider=gemini` (Gemini 2.5 Flash)
- **Music**: `provider=kie&model=V4_5PLUS` (Highest quality Suno model)
- **Speech-to-Text**: `provider=elevenlabs&model=scribe_v1` (29+ languages)

### **For Speed**  
- **Video**: `provider=kie&model=veo3_fast` (Fast generation)
- **Image**: `provider=openai` (DALL-E 3)
- **Music**: `provider=kie&model=V4` (Fast music generation)
- **Speech-to-Text**: `provider=elevenlabs&model=scribe_v1_experimental` (Latest features)

### **For Reliability**
- **Video**: `provider=replicate&model=kling-v2.1` (Stable, proven)
- **Image**: `provider=gemini` (Consistent results)
- **Music**: `provider=kie&model=V4_5` (Balanced quality and reliability)
- **Speech-to-Text**: Default Lemonfox API (Simple, reliable)

## 🔍 Response Format

```json
{
  "taskId": "uuid-string",
  "status": "completed|pending|error",
  "result": {
    "text": "processed prompt",
    "url": "https://domain.com/tmp/file.mp4"
  }
}
```

## 💡 Tips & Best Practices

1. **Optimize Prompts**: Use detailed, specific descriptions
2. **Choose Models Wisely**: Balance quality vs speed based on needs  
3. **Handle Errors**: Implement retry mechanisms for network issues
4. **Monitor Usage**: Track API quotas and costs
5. **File Management**: Download generated content promptly

## 🆘 Support

For issues and questions:
- Check API documentation for each provider
- Review server logs for detailed error information
- Contact provider support for API-specific issues

## 📊 Provider Comparison

| Provider | Video Quality | Image Quality | Music Quality | Speech-to-Text | Speed | Cost | Models |
|----------|---------------|---------------|---------------|----------------|-------|------|--------|
| **Kie.ai** | 🥇 Excellent | ➖ N/A | 🥇 Excellent | ➖ N/A | ⚡ Fast | 💰 Low | 15+ models |
| **Gemini** | 🥈 Very Good | 🥇 Excellent | ➖ N/A | ➖ N/A | ⚡ Fast | 💰 Low | Veo 3, Gemini 2.5 |
| **Replicate** | 🥈 Very Good | ➖ N/A | ➖ N/A | ➖ N/A | 🐌 Medium | 💰💰 Medium | 10+ models |
| **OpenAI** | ➖ N/A | 🥇 Excellent | ➖ N/A | ➖ N/A | ⚡ Fast | 💰💰💰 High | DALL-E 3 |
| **ElevenLabs** | ➖ N/A | ➖ N/A | ➖ N/A | 🥇 Excellent | ⚡ Fast | 💰 Low | Multilingual STT |

### 🎵 Music Generation Options (Kie.ai/Suno)

| Model | Quality | Speed | Use Case |
|-------|---------|-------|----------|
| **V4_5PLUS** | 🥇 Best | 🐌 Slow | Professional production |
| **V4_5** | 🥈 High | ⚡ Medium | Balanced quality/speed |
| **V4** | 🥉 Good | ⚡ Fast | Quick demos/prototypes |
| **V3_5** | 🥉 Basic | ⚡ Very Fast | Simple background music |

### 🎤 Speech-to-Text Options (ElevenLabs)

| Model | Quality | Languages | Features | Use Case |
|-------|---------|-----------|----------|----------|
| **scribe_v1** | 🥇 Best | 29+ Languages | Noise removal, filler removal | Professional transcription |
| **scribe_v1_experimental** | 🥈 High | 29+ Languages | Latest improvements, experimental | Testing new features |

#### Available Options:
- **Language**: Auto-detect or specify (en, es, fr, de, it, pt, hi, ar, etc.)
- **Noise Removal**: Remove background noise (default: true)
- **Filler Removal**: Remove "um", "uh", filler words (default: true)
- **Optimize Latency**: 0-4 (0=highest quality, 4=lowest latency)
