import type { Request, Response } from "express";
import { z, ZodError, type ZodIssue } from "zod";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ValidationError } from "../utils/errors.js";
import { logger } from "../lib/logger.js";
import {
  createComic,
  generateThumbnailUploadUrl,
  updateComicPricing,
  getComicPricing,
  updateComicStatus,
  getPublicComicsList,
  getPublicComicDetails,
  updateComic,
  getLoraUploadUrl,
} from "../services/comic.service.js";
import { comicFilterQuerySchema, getLoraUploadUrlSchema } from "../validators/comic.schema.js";

const uploadThumbnailRequestSchema = z.object({
  fileName: z.string().min(1, "File name is required"),
  contentType: z
    .string()
    .regex(
      /^image\/(png|jpeg|jpg|webp)$/,
      "Invalid content type. Only PNG, JPEG, and WEBP images are allowed for thumbnails."
    ),
});

export const getThumbnailUploadUrlHandler = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      logger.debug(
        { body: req.body },
        "Incoming request for comic thumbnail upload URL"
      );

      const { fileName, contentType } = uploadThumbnailRequestSchema.parse(
        req.body
      );

      const { uploadUrl, key } = await generateThumbnailUploadUrl(
        fileName,
        contentType
      );

      res.status(200).json({
        success: true,
        message: "Presigned thumbnail upload URL generated successfully",
        data: {
          uploadUrl,
          key,
        },
      });
    } catch (error: any) {
      if (error instanceof ZodError) {
        const errorMessages = error.issues
          .map((issue: ZodIssue) => issue.message)
          .join(", ");
        throw new ValidationError(errorMessages);
      }
      throw error;
    }
  }
);

export const createComicHandler = asyncHandler(
  async (req: Request, res: Response) => {
    logger.debug(
      { body: req.body },
      "Incoming request to create comic (Validation Passed)"
    );

    const newComic = await createComic(req.body);

    res.status(201).json({
      success: true,
      message: "Comic catalogue item created successfully.",
      data: newComic,
    });
  }
);

export const updateComicHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { comicId } = req.params;

    if (!comicId || typeof comicId !== "string") {
      throw new ValidationError("comicId param is required");
    }

    const updatedComic = await updateComic(comicId, req.body);

    res.status(200).json(updatedComic);
  }
);

export const updateComicPricingHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { comicId } = req.params;

    if (!comicId || typeof comicId !== "string") {
      throw new ValidationError("Comic ID is required in the URL parameters.");
    }

    logger.debug(
      { comicId, body: req.body },
      "Incoming request to replace pricing rules"
    );

    const updatedComic = await updateComicPricing(comicId, req.body);

    res.status(200).json({
      success: true,
      message: "Pricing rules fully replaced.",
      data: updatedComic,
    });
  }
);

export const getComicPricingHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { comicId } = req.params;

    if (!comicId || typeof comicId !== "string") {
      throw new ValidationError(
        "Comic ID is required and must be a single valid string."
      );
    }

    logger.debug({ comicId }, "Incoming request to fetch comic pricing rules");

    const pricingData = await getComicPricing(comicId);

    res.status(200).json({
      success: true,
      message: "Pricing rules fetched successfully.",
      data: pricingData,
    });
  }
);

export const updateComicStatusHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { comicId } = req.params;

    if (!comicId || typeof comicId !== "string") {
      throw new ValidationError(
        "Comic ID is required and must be a single valid string."
      );
    }

    logger.debug(
      { comicId, body: req.body },
      "Incoming request to update comic status"
    );

    // req.body is validated by the router middleware
    const updatedComic = await updateComicStatus(comicId, req.body);

    res.status(200).json({
      success: true,
      message: `Comic status successfully changed to ${updatedComic.status}.`,
      data: updatedComic,
    });
  }
);

export const getPublicComicsHandler = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const validatedQuery = comicFilterQuerySchema.parse(req.query);

      const comics = await getPublicComicsList(validatedQuery.gender);

      res.status(200).json({
        success: true,
        data: comics,
      });
    } catch (error: any) {
      if (error instanceof ZodError) {
        const errorMessages = error.issues
          .map((issue) => issue.message)
          .join(", ");
        throw new ValidationError(`Query error: ${errorMessages}`);
      }
      throw error;
    }
  }
);


export const getPublicComicDetailsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { comicId } = req.params;

  if (!comicId || typeof comicId !== "string") {
    throw new ValidationError("Comic ID is required.");
  }

  const comic = await getPublicComicDetails(comicId);

  res.status(200).json({
    success: true,
    data: comic,
  });
});

//
export const getLoraUploadUrlHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await getLoraUploadUrl(req.body);
    res.status(200).json(result);
  }
);
