import { z } from 'zod';

export const TaskTypeSchema = z.enum([
  'text-to-image',
  'text-to-video',
  'text-to-music',
  'gemini-chat',
  'openai-chat'
]);

export const TaskProviderSchema = z.enum([
  'openai',
  'gemini',
  'replicate',
  'kie'
]).optional();

export const StartTaskSchema = z.object({
  type: TaskTypeSchema,
  prompt: z.string().min(1, "Prompt is required"),
  provider: TaskProviderSchema,
  model: z.string().optional(),
  
  // Music specific options
  style: z.string().optional(),
  duration: z.number().optional(),
  genre: z.string().optional(),
  mood: z.string().optional(),
  tempo: z.string().optional(),
  instruments: z.string().optional(),
  vocalStyle: z.string().optional(),
  language: z.string().optional(),
  key: z.string().optional(),
  timeSignature: z.string().optional(),
  quality: z.string().optional(),
  customMode: z.boolean().optional(),
  instrumental: z.boolean().optional(),
  advanced: z.boolean().optional(),

  // Chat specific options
  conversationHistory: z.array(z.any()).optional(),
}).passthrough(); // Allow other properties for flexibility

export type StartTaskRequest = z.infer<typeof StartTaskSchema>;
