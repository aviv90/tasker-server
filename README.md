# tasker-server

A Node.js server for generating images using AI services (Gemini and OpenAI).

## Features

- **Text-to-Image Generation** using Google Gemini or OpenAI DALL-E
- **Image Editing** using Google Gemini
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

**Response:**
```json
{
  "taskId": "uuid-string"
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
  "result": "http://localhost:3000/static/image.png",
  "text": "Generated description"
}
```

## Environment Variables

Create a `.env` file with:

```env
GEMINI_API_KEY=your_gemini_api_key
OPENAI_API_KEY=your_openai_api_key
PORT=3000
```

## Installation

```bash
npm install
npm start
```

## Providers

- **Gemini 2.0 Flash Preview**: Google's latest image generation model with enhanced capabilities
  - Supports text-to-image and image editing
  - Includes SynthID watermark for safety
  - Best for contextually relevant images with world knowledge
- **OpenAI GPT-Image-1**: OpenAI's newest image generation model
  - Always returns base64 encoded images
  - High quality output with advanced prompting
  - Specify `"provider": "openai"` to use