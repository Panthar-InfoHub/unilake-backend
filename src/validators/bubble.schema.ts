import { z } from "zod";
import {
  BUBBLE_BOUND_EPSILON,
  DEFAULT_FONT_SIZE,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
} from "../config/generation.js";

// Bubble geometry is normalized to 0–1 fractions of the artwork, never pixels.
// x/y is the top-left corner; the whole rectangle must fit inside the page.
export const createBubbleSchema = z
  .object({
    x: z
      .number()
      .min(0, "x must be a 0–1 fraction of the artwork width")
      .max(1, "x must be a 0–1 fraction of the artwork width"),
    y: z
      .number()
      .min(0, "y must be a 0–1 fraction of the artwork height")
      .max(1, "y must be a 0–1 fraction of the artwork height"),
    width: z
      .number()
      .gt(0, "width must be greater than 0")
      .max(1, "width cannot exceed the full artwork width"),
    height: z
      .number()
      .gt(0, "height must be greater than 0")
      .max(1, "height cannot exceed the full artwork height"),
    dialogue: z.string().min(1),
    fontId: z.string().uuid().optional(),
    // Fraction of the artwork's HEIGHT, not pixels.
    fontSize: z
      .number()
      .min(MIN_FONT_SIZE, `fontSize must be at least ${MIN_FONT_SIZE}`)
      .max(MAX_FONT_SIZE, `fontSize cannot exceed ${MAX_FONT_SIZE}`)
      .default(DEFAULT_FONT_SIZE),
    sortOrder: z.number().int().default(0),
  })
  // x and width are each individually valid but can still overflow together —
  // only an object-level check catches that.
  .refine((data) => data.x + data.width <= 1 + BUBBLE_BOUND_EPSILON, {
    message: "Bubble extends past the right edge of the artwork",
    path: ["width"],
  })
  .refine((data) => data.y + data.height <= 1 + BUBBLE_BOUND_EPSILON, {
    message: "Bubble extends past the bottom edge of the artwork",
    path: ["height"],
  });

// No sum refine here: PATCH is partial, so Zod may only see `x` and have no idea
// what `width` is. That cross-check lives in bubble.service.updateBubble(),
// where the existing row is available to merge against.
export const updateBubbleSchema = z
  .object({
    x: z
      .number()
      .min(0, "x must be a 0–1 fraction of the artwork width")
      .max(1, "x must be a 0–1 fraction of the artwork width")
      .optional(),
    y: z
      .number()
      .min(0, "y must be a 0–1 fraction of the artwork height")
      .max(1, "y must be a 0–1 fraction of the artwork height")
      .optional(),
    width: z
      .number()
      .gt(0, "width must be greater than 0")
      .max(1, "width cannot exceed the full artwork width")
      .optional(),
    height: z
      .number()
      .gt(0, "height must be greater than 0")
      .max(1, "height cannot exceed the full artwork height")
      .optional(),
    dialogue: z.string().min(1).optional(),
    fontId: z.string().uuid().nullable().optional(),
    fontSize: z
      .number()
      .min(MIN_FONT_SIZE, `fontSize must be at least ${MIN_FONT_SIZE}`)
      .max(MAX_FONT_SIZE, `fontSize cannot exceed ${MAX_FONT_SIZE}`)
      .optional(),
    sortOrder: z.number().int().nonnegative().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export type CreateBubbleInput = z.infer<typeof createBubbleSchema>;
export type UpdateBubbleInput = z.infer<typeof updateBubbleSchema>;