import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ValidationError } from "../utils/errors.js";
import { sendSuccess } from "../utils/response.js";
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

    sendSuccess(res, 200, result);
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

    sendSuccess(res, 201, result);
  }
);


export const listComicPagesHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { comicId } = req.params;

    if (!comicId || typeof comicId !== "string") {
      throw new ValidationError("comicId param is required");
    }

    const pages = await listComicPages(comicId);

    sendSuccess(res, 200, pages);
  }
);

export const updatePageHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { pageId } = req.params;

    if (!pageId || typeof pageId !== "string") {
      throw new ValidationError("pageId param is required");
    }

    const page = await updatePage(pageId, req.body);

    sendSuccess(res, 200, page);
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
