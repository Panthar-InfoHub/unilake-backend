import { randomUUID } from "node:crypto";
import { getPublicUrl, getSignedUploadUrl } from "../lib/r2.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors.js";
import type {
  CreateComicInput,
  UpdateComicPricingInput,
  UpdateComicStatusInput
} from "../validators/comic.schema.js";

export const generateThumbnailUploadUrl = async (
  fileName: string,
  contentType: string
) => {
  const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");

  const key = `comics/temp/${randomUUID()}-${safeFileName}`;

  logger.info(
    { key, contentType },
    "Requesting presigned URL for comic thumbnail"
  );

  const uploadUrl = await getSignedUploadUrl("public", key, contentType, 900);

  return { uploadUrl, key };
};

export const createComic = async (data: CreateComicInput) => {
  try {
    logger.info(
      { title: data.title },
      "Attempting to create new comic catalogue item..."
    );

    const { thumbnailKey, pricing, ...restData } = data;

    const coverThumbnailUrl = getPublicUrl(thumbnailKey);

    const newComic = await prisma.$transaction(async (tx) => {
      const comic = await tx.comic.create({
        data: {
          ...restData,
          coverThumbnailUrl,
          status: "DRAFT",
        },
      });

      // Step B: Bulk-insert the pricing rules linked to the new comic's ID
      await tx.pricingRule.createMany({
        data: pricing.map((p) => ({
          comicId: comic.id,
          countryId: p.countryId,
          price: p.price,
        })),
      });
      return comic;
    });

    logger.info(
      { comicId: newComic.id },
      "Successfully created draft comic with pricing rules"
    );
    return newComic;
  } catch (error: any) {
    logger.error({ err: error, data }, "Failed to create comic in database");

    if (error.code === "P2002") {
      throw new ConflictError(
        "A pricing rule conflict occurred, or a comic with this parameter exists."
      );
    }

    throw error;
  }
};

export const updateComicPricing = async (
  comicId: string,
  data: UpdateComicPricingInput
) => {
  try {
    logger.info(
      { comicId },
      "Executing full-replace of comic pricing rules..."
    );

    const updatedComic = await prisma.$transaction(async (tx) => {
      const existingComic = await tx.comic.findUnique({
        where: { id: comicId },
      });

      if (!existingComic) {
        throw new NotFoundError("Comic not found.");
      }

      await tx.pricingRule.deleteMany({
        where: { comicId },
      });

      await tx.pricingRule.createMany({
        data: data.pricing.map((p) => ({
          comicId,
          countryId: p.countryId,
          price: p.price,
        })),
      });

      return tx.comic.findUnique({
        where: { id: comicId },
        include: { pricingRules: true },
      });
    });

    logger.info({ comicId }, "Successfully replaced comic pricing rules");
    return updatedComic;
  } catch (error: any) {
    logger.error({ err: error, comicId }, "Failed to replace pricing rules");
    throw error;
  }
};

export const getComicPricing = async (comicId: string) =>{
  try {
    logger.debug({ comicId }, "Fetching pricing rules for comic...");

    const comicExists = await prisma.comic.findUnique({
      where: { id: comicId },
      select: { id: true }, 
    });

    if (!comicExists) {
      throw new NotFoundError("Comic not found.");
    }

    const pricingRules = await prisma.pricingRule.findMany({
      where: { comicId },
      include: {
        country: {
          select: {
            id: true,
            name: true,
            code: true,
            currencyCode: true,
            flagUrl: true,
          },
        },
      },
      orderBy: {
        country: {
          name: "asc",
        },
      },
    });

    return pricingRules;
  } catch (error: any) {
    logger.error({ err: error, comicId }, "Failed to fetch comic pricing rules");
    throw error;
  }
}

export const updateComicStatus = async (comicId: string, data: UpdateComicStatusInput) => {
  try {
    logger.info({ comicId, targetStatus: data.status }, "Attempting to update comic status...");

    const comic = await prisma.comic.findUnique({
      where: { id: comicId },
      include: { pricingRules: true },
    });

    if (!comic) {
      throw new NotFoundError("Comic not found.");
    }

    if (data.status === "PUBLISHED") {
      if (!comic.coverThumbnailUrl) {
        throw new ValidationError("Cannot publish comic: Missing cover thumbnail.");
      }
      
      if (comic.pricingRules.length === 0) {
        throw new ValidationError("Cannot publish comic: At least one pricing rule is required.");
      }
    }

    const updatedComic = await prisma.comic.update({
      where: { id: comicId },
      data: { status: data.status },
    });

    logger.info({ comicId, newStatus: updatedComic.status }, "Successfully updated comic status");
    return updatedComic;

  } catch (error: any) {
    logger.error({ err: error, comicId }, "Failed to update comic status");
    throw error;
  }
};

export const getPublicComicsList = async (gender?: "BOY" | "GIRL" | "UNISEX") => {
  return await prisma.comic.findMany({
    where : {
      status: "PUBLISHED",
      ...(gender&& { genderTag: gender }),
    },
    select: {
      id: true,
      title: true,
      genderTag: true,
      pageCount: true,
      coverThumbnailUrl: true,
      pricingRules: {
        select:{
          price: true,
          country:{
            select : {
              code : true,
              name: true,
              flagUrl: true,
              currencyCode: true
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })
}

export const getPublicComicDetails = async (comicId : string) => {
  const comic =  await prisma.comic.findFirst({
    where : {
      id : comicId,
      status : "PUBLISHED",
    },
    select: {
      id: true,
      title: true,
      genderTag: true,
      pageCount: true,
      freePreviewPages: true,
      coverThumbnailUrl: true,
      pricingRules: {
        select: {
          price: true,
          country: {
            select :{
              code : true,
              name : true,
              flagUrl: true,
              currencyCode: true,
            },
          },
        },
      },
      pages : {
        where  : {isPreviewPage: true},
        orderBy: { pageNumber: "asc" },
        select: {
          id: true,
          pageNumber: true,
          artworkUrl: true,
        },
      },
    },
  });

  if (!comic) {
    throw new NotFoundError("Comic not found or not available.");
  }

  return comic;
}
