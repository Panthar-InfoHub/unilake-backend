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

export const updateBubbleSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  dialogue: z.string().min(1).optional(),
  fontId: z.string().uuid().nullable().optional(),
  fontSize: z.number().int().positive().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: "At least one field must be provided",
});

export type CreateBubbleInput = z.infer<typeof createBubbleSchema>;
export type UpdateBubbleInput = z.infer<typeof updateBubbleSchema>;