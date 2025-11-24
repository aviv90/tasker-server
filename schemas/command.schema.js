const { z } = require('zod');

/**
 * Schema for Command storage
 */
const commandSchema = z.object({
  chatId: z.string().min(1, "Chat ID is required"),
  messageId: z.string().min(1, "Message ID is required"),
  tool: z.string().nullable().optional(), // Tool name is optional (can be null)
  toolArgs: z.any().nullable().optional(), // Changed from z.record() to z.any() to handle any structure
  args: z.any().nullable().optional(), // Changed from z.record() to z.any() to handle any structure
  plan: z.any().nullable().optional(), // Changed from z.record() to z.any() to handle any structure
  isMultiStep: z.boolean().optional().default(false),
  prompt: z.string().nullable().optional(),
  result: z.any().nullable().optional(),
  failed: z.boolean().optional().default(false),
  normalized: z.any().nullable().optional(),
  imageUrl: z.string().nullable().optional(), // Removed .url() validation to allow null/undefined
  videoUrl: z.string().nullable().optional(), // Removed .url() validation to allow null/undefined
  audioUrl: z.string().nullable().optional(), // Removed .url() validation to allow null/undefined
  timestamp: z.number().int().positive().optional() // usually generated on server side
}).passthrough(); // Allow additional properties

module.exports = { commandSchema };

