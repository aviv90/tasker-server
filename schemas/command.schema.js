const { z } = require('zod');

/**
 * Schema for Command storage
 */
const commandSchema = z.object({
  chatId: z.string().min(1, "Chat ID is required"),
  messageId: z.string().min(1, "Message ID is required"),
  tool: z.string().min(1, "Tool name is required"),
  toolArgs: z.record(z.any()).nullable().optional(),
  args: z.record(z.any()).nullable().optional(),
  plan: z.record(z.any()).nullable().optional(),
  isMultiStep: z.boolean().optional().default(false),
  prompt: z.string().nullable().optional(),
  result: z.any().nullable().optional(),
  failed: z.boolean().optional().default(false),
  normalized: z.any().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  videoUrl: z.string().url().nullable().optional(),
  audioUrl: z.string().url().nullable().optional(),
  timestamp: z.number().int().positive().optional() // usually generated on server side
});

module.exports = { commandSchema };

