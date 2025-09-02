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
- **Audio Transcription**: Convert speech to text

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
```

5. **Start server**
```bash
npm start
```

## 🎯 Model Recommendations

### **For Maximum Quality**
- **Video**: `provider=kie&model=veo3` (HD 1080p with audio)
- **Image**: `provider=gemini` (Gemini 2.5 Flash)

### **For Speed**  
- **Video**: `provider=kie&model=veo3_fast` (Fast generation)
- **Image**: `provider=openai` (DALL-E 3)

### **For Reliability**
- **Video**: `provider=replicate&model=kling-v2.1` (Stable, proven)
- **Image**: `provider=gemini` (Consistent results)

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

| Provider | Video Quality | Speed | Cost | Models |
|----------|---------------|-------|------|--------|
| **Kie.ai** | 🥇 Excellent | ⚡ Fast | 💰 Low | 8+ models |
| **Gemini** | 🥈 Very Good | ⚡ Fast | 💰 Low | Veo 3 |
| **Replicate** | 🥈 Very Good | 🐌 Medium | 💰💰 Medium | 10+ models |
| **OpenAI** | 🥇 Excellent | ⚡ Fast | 💰💰💰 High | DALL-E 3 |
