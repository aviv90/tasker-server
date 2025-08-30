# tasker-server

A Node.js server for multimedia AI processing including image generation, video creation, and audio transcription.

## Features

- **Text-to-Image Generation** using Google Gemini or OpenAI DALL-E
- **Image Editing** using Google Gemini or OpenAI
- **Text-to-Video Generation** using Kling v2.1 Master, Veo 3 Fast, or Gemini Veo 3
- **Image-to-Video Generation** using Kling v2.1 Master or Veo 3 Fast  
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
  "provider": "replicate", // or "gemini" for text-to-video 
  "model": "kling" // or "veo3" (optional, default: "kling")
}
```

**Model Options:**
- `"kling"` (default): Kling v2.1 Master - Premium quality, 1080p, $1.40
- `"veo3"`: Veo 3 Fast - With audio, 720p landscape, $3.20
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
  "provider": "replicate",
  "model": "kling" // or "veo3" (optional, default: "kling")
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

- **Kling v2.1 Master**: Premium video generation (default)
  - Exceptional text-to-video and image-to-video quality
  - 1080p resolution, superb dynamics and prompt adherence
  - Cost: $1.40 per 5-second video

- **Veo 3 Fast**: Google's fast video generation via Replicate
  - High-quality video generation with audio support
  - 720p resolution, landscape orientation only
  - Cost: $3.20 per video

- **Gemini**: Advanced text-to-video generation with Veo 3
  - Direct Google API integration
  - High-quality video generation
  - Text-to-video, image-to-video, and video-to-video
  - High-quality models like Runway Gen-4 Aleph
  - Better for complex video transformations

- **Lemonfox**: Audio transcription service
  - Supports Hebrew and multiple languages
  - High accuracy transcription
  - Audio file format flexibility