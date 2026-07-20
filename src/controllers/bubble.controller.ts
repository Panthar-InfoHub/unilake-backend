import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ValidationError } from "../utils/errors.js";
import {
  createBubble,
  listPageBubbles,
  updateBubble,
  deleteBubble,
} from "../services/bubble.service.js";
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


export const listPageBubblesHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { pageId } = req.params;

    if (!pageId || typeof pageId !== "string") {
      throw new ValidationError("pageId param is required");
    }

    const bubbles = await listPageBubbles(pageId);

    res.status(200).json({
      success: true,
      data: bubbles,
    });
  }
);

export const updateBubbleHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { bubbleId } = req.params;

    if (!bubbleId || typeof bubbleId !== "string") {
      throw new ValidationError("bubbleId param is required");
    }

    const bubble = await updateBubble(bubbleId, req.body);

    res.status(200).json({
      success: true,
      data: bubble,
    });
  }
);

export const deleteBubbleHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { bubbleId } = req.params;

    if (!bubbleId || typeof bubbleId !== "string") {
      throw new ValidationError("bubbleId param is required");
    }

    await deleteBubble(bubbleId);

    res.status(204).send();
  }
);
