import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ValidationError } from "../utils/errors.js";
import { getFontUploadUrl, createFont, listComicFonts, updateFont, deleteFont} from "../services/font.service.js";
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


export const listComicFontsHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { comicId } = req.params;

    if (!comicId || typeof comicId !== "string") {
      throw new ValidationError("comicId param is required");
    }

    const fonts = await listComicFonts(comicId);

    res.status(200).json({
      success: true,
      data: fonts,
    });
  }
);

export const updateFontHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { fontId } = req.params;

    if (!fontId || typeof fontId !== "string") {
      throw new ValidationError("fontId param is required");
    }

    const font = await updateFont(fontId, req.body);

    res.status(200).json({
      success: true,
      data: font,
    });
  }
);

export const deleteFontHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { fontId } = req.params;

    if (!fontId || typeof fontId !== "string") {
      throw new ValidationError("fontId param is required");
    }

    await deleteFont(fontId);

    res.status(204).send();
  }
);