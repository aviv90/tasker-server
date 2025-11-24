import { z } from 'zod';

/**
 * Schema for Contact
 */
export const contactSchema = z.object({
  id: z.string().min(1, "Contact ID is required"), // Maps to contact_id
  name: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  chatId: z.string().nullable().optional() // For raw_data usually
}).passthrough(); // Allow other properties in raw_data

