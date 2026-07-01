import { z } from "zod";

export const createBubbleSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  dialogue: z.string().min(1),
  fontId: z.string().uuid().optional(),
  fontSize: z.number().int().positive().default(24),
  sortOrder: z.number().int().default(0),
});

export type CreateBubbleInput = z.infer<typeof createBubbleSchema>;