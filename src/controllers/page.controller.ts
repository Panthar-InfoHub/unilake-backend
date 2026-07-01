import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ValidationError } from "../utils/errors.js";
import {
  createPage,
  getPageArtworkUploadUrl,
} from "../services/page.service.js";
import {
  createPageSchema,
  getPageArtworkUploadUrlSchema,
} from "../validators/page.schema.js";

export const getPageArtworkUploadUrlHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { comicId } = req.params;

    if (!comicId || typeof comicId !== "string") {
      throw new ValidationError("comicId param is required");
    }

    const input = getPageArtworkUploadUrlSchema.parse(req.body);
    const result = await getPageArtworkUploadUrl(comicId, input);

    res.status(200).json(result);
  }
);

export const createPageHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { comicId } = req.params;

    if (!comicId || typeof comicId !== "string") {
      throw new ValidationError("comicId param is required");
    }

    const input = createPageSchema.parse(req.body);
    const result = await createPage(comicId, input);

    res.status(201).json(result);
  }
);
