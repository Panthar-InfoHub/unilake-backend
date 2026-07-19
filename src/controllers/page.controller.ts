import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ValidationError } from "../utils/errors.js";
import {
  createPage,
  getPageArtworkUploadUrl,
  listComicPages,
  updatePage,
  deletePage,
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


export const listComicPagesHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { comicId } = req.params;

    if (!comicId || typeof comicId !== "string") {
      throw new ValidationError("comicId param is required");
    }

    const pages = await listComicPages(comicId);

    res.status(200).json({
      success: true,
      data: pages,
    });
  }
);

export const updatePageHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { pageId } = req.params;

    if (!pageId || typeof pageId !== "string") {
      throw new ValidationError("pageId param is required");
    }

    const page = await updatePage(pageId, req.body);

    res.status(200).json({
      success: true,
      data: page,
    });
  }
);

export const deletePageHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { pageId } = req.params;

    if (!pageId || typeof pageId !== "string") {
      throw new ValidationError("pageId param is required");
    }

    await deletePage(pageId);

    res.status(204).send();
  }
);
