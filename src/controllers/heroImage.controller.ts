import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createHeroImage, deleteHeroImage, getActiveHeroImages, getAllHeroImages, getHeroImageUploadUrl, toggleHeroImageStatus } from "../services/heroImage.service.js";

export const getHeroImageUploadUrlHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await getHeroImageUploadUrl(req.body);
    res.status(200).json(result);
  }
);

export const createHeroImageHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const heroImage = await createHeroImage(req.body);
    res.status(201).json(heroImage);
  }
);


export const toggleHeroImageStatusHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const heroImage = await toggleHeroImageStatus(id as string);
    res.json(heroImage);
  }
);



export const getAllHeroImagesHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const heroImages = await getAllHeroImages();
    res.json(heroImages);
  }
);


export const getActiveHeroImagesHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const heroImages = await getActiveHeroImages();
    res.json(heroImages);
  }
);


export const deleteHeroImageHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    await deleteHeroImage(id as string);
    res.status(204).send();
  }
);