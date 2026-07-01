import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ValidationError } from "../utils/errors.js";
import { createBubble } from "../services/bubble.service.js";
import { createBubbleSchema } from "../validators/bubble.schema.js";

export const createBubbleHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { pageId } = req.params;

    if (!pageId || typeof pageId !== "string") {
      throw new ValidationError("pageId param is required");
    }

    const input = createBubbleSchema.parse(req.body);
    const result = await createBubble(pageId, input);

    res.status(201).json(result);
  }
);