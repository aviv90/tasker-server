# tasker-server

A Node.js server for multimedia AI processing including image generation, video creation, and audio transcription.

## Features

- **Text-to-Image Generation** using Google Gemini or OpenAI DALL-E
- **Image Editing** using Google Gemini or OpenAI
- **Text-to-Video Generation** using Kling v2.1 Master or Gemini Veo 3
- **Image-to-Video Generation** using Kling v2.1 Master  
- **Video-to-Video Transformation** using Replicate
- **Audio Transcription** using Lemonfox
- RESTful API with task-based processing
- Support for multiple AI providers

## API Endpoints

### Generate Image from Text

```bash
POST /api/start-task
Content-Type: application/json

{
  "type": "text-to-image",
  "prompt": "Your image description here",
  "provider": "openai" // or "gemini" (default)
}
```

### Generate Video from Text

```bash
POST /api/start-task
Content-Type: application/json

{
  "type": "text-to-video",
  "prompt": "Your video description here",
  "provider": "replicate" // or "gemini" for text-to-video (uses Kling v2.1 Master)
}
```

### Upload and Edit Image

```bash
POST /api/upload-edit
Content-Type: multipart/form-data

{
  "file": [image file],
  "prompt": "Edit description",
  "provider": "openai" // or "gemini" (default)
}
```

### Upload Image and Generate Video

```bash
POST /api/upload-video
Content-Type: multipart/form-data

{
  "file": [image file],
  "prompt": "Video description",
  "provider": "replicate"
}
```

### Upload Video and Transform

```bash
POST /api/upload-video-edit
Content-Type: multipart/form-data

{
  "file": [video file],
  "prompt": "Transformation description"
}
```

### Upload Audio and Transcribe

```bash
POST /api/upload-transcribe
Content-Type: multipart/form-data

{
  "file": [audio file]
}
```

### Check Task Status

```bash
GET /api/task-status/{taskId}
```

**Response:**
```json
{
  "status": "done",
  "result": "http://localhost:3000/static/file.ext",
  "text": "Generated description",
  "cost": "0.0123"
}
```

## Environment Variables

Create a `.env` file with:

```env
OPENAI_API_KEY=your_openai_api_key
REPLICATE_API_TOKEN=your_replicate_token
GEMINI_API_KEY=your_gemini_api_key
LEMONFOX_API_KEY=your_lemonfox_api_key
PORT=3000
```

## Installation

```bash
npm install
npm start
```

## Providers

- **Gemini 2.0 Flash Preview**: Google's latest image generation model
  - Text-to-image and image editing
  - SynthID watermark for safety
  - Best for contextually relevant images

- **OpenAI DALL-E**: OpenAI's image generation model
  - High quality image generation and editing
  - Advanced prompting capabilities
  - Base64 encoded output

- **Kling v2.1 Master**: Premium video generation (primary provider)
  - Exceptional text-to-video and image-to-video quality
  - 1080p resolution, superb dynamics and prompt adherence
  - Professional-grade video generation

- **Gemini**: Advanced text-to-video generation with Veo 3
  - Text-to-video, image-to-video, and video-to-video
  - High-quality models like Runway Gen-4 Aleph
  - Better for complex video transformations

- **Lemonfox**: Audio transcription service
  - Supports Hebrew and multiple languages
  - High accuracy transcription
  - Audio file format flexibility