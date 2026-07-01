import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ValidationError } from "../utils/errors.js";
import { getFontUploadUrl, createFont } from "../services/font.service.js";
import {
  getFontUploadUrlSchema,
  createFontSchema,
} from "../validators/font.schema.js";


export const getFontUploadUrlHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { comicId } = req.params;

    if (!comicId || typeof comicId !== "string") {
      throw new ValidationError("comicId param is required");
    }

    const input = getFontUploadUrlSchema.parse(req.body);
    const result = await getFontUploadUrl(comicId, input);

    res.status(200).json(result);
  }
);


export const createFontHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { comicId } = req.params;

    if (!comicId || typeof comicId !== "string") {
      throw new ValidationError("comicId param is required");
    }

    const input = createFontSchema.parse(req.body);
    const result = await createFont(comicId, input);

    res.status(201).json(result);
  }
);