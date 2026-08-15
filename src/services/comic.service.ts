import { randomUUID } from "node:crypto";
import { deleteFile, getPublicUrl, getSignedUploadUrl } from "../lib/r2.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { config } from "../config/env.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../utils/errors.js";
import type {
  AdminComicFilterQueryInput,
  ComicFilterQueryInput,
  CreateComicInput,
  GetLoraUploadUrlInput,
  UpdateComicPricingInput,
  UpdateComicStatusInput,
  UploadThumbnailsBatchInput,
} from "../validators/comic.schema.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { UpdateComicInput } from "../validators/comic.schema.js";

/**
 * Accepts either a raw R2 key or a full public URL and always returns a key.
 *
 * Thumbnails are the only asset stored as an ARRAY, which means updating them
 * requires the client to re-send the entries it wants to KEEP. Those come back
 * from GET as full URLs, so tolerating both forms here lets the frontend send
 * exactly what it received (minus whatever it is deleting) instead of having to
 * know R2_PUBLIC_URL_BASE and reverse the conversion itself — a mismatch there
 * would silently produce doubled URLs.
 *
 * Kept local deliberately. r2.getKeyFromPublicUrl() is reserved for the SD
 * worker: it assumes its input is always a URL, whereas this one handles
 * untrusted client input that may legitimately be either form.
 */
const normalizeThumbnailInput = (input: string): string => {
  const publicBase = config.r2.publicUrlBase.replace(/\/$/, "");
  const prefix = `${publicBase}/`;

  return input.startsWith(prefix) ? input.slice(prefix.length) : input;
};

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

    const { thumbnailKeys, pricing, loraKey, ...restData } = data;
    // Create only ever receives fresh keys today, but normalizing here keeps
    // create and update behaving identically for any future caller.
    const coverThumbnailUrls = thumbnailKeys.map((entry) =>
      getPublicUrl(normalizeThumbnailInput(entry))
    );

    const newComic = await prisma.$transaction(async (tx) => {
      const comic = await tx.comic.create({
        data: {
          ...restData,
          coverThumbnailUrls,
          status: "DRAFT",
          ...(loraKey !== undefined && { loraFileUrl: loraKey }),
        },
      });

      // Step B: Bulk-insert the pricing rules linked to the new comic's ID
      await tx.pricingRule.createMany({
        data: pricing.map((p) => ({
          comicId: comic.id,
          countryId: p.countryId,
          coverType: p.coverType,
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

export const updateComic = async (comicId: string, data: UpdateComicInput) => {
  try {
    const comic = await prisma.comic.findUnique({ where: { id: comicId } });

    if (!comic) {
      throw new NotFoundError("Comic not found.");
    }

    const updateData: Prisma.ComicUpdateInput = {};
    let oldR2KeysToDelete: string[] = [];

    if (data.title !== undefined) updateData.title = data.title;
    if (data.genderTag !== undefined) updateData.genderTag = data.genderTag;
    if (data.pageCount !== undefined) updateData.pageCount = data.pageCount;
    if (data.freePreviewPages !== undefined) updateData.freePreviewPages = data.freePreviewPages;
    if (data.loraStrength !== undefined) updateData.loraStrength = data.loraStrength;
    if (data.loraKey !== undefined) updateData.loraFileUrl = data.loraKey;
    if (data.thumbnailKeys !== undefined) {
      // Entries may arrive as freshly-uploaded keys OR as URLs the client is
      // re-sending to keep. Normalizing both to keys first means the diff below
      // compares like with like, so a kept thumbnail is never seen as removed.
      const newUrls = data.thumbnailKeys.map((entry) =>
        getPublicUrl(normalizeThumbnailInput(entry))
      );
      updateData.coverThumbnailUrls = newUrls;

      const publicBase = config.r2.publicUrlBase.replace(/\/$/, "");
      const removedUrls = comic.coverThumbnailUrls.filter((u) => !newUrls.includes(u));
      oldR2KeysToDelete = removedUrls.map((u) => u.replace(`${publicBase}/`, ""));
    }
    if (data.description !== undefined) updateData.description = data.description;
    if (data.themeId !== undefined) updateData.theme = { connect: { id: data.themeId } };
    if (data.ageGroup !== undefined) updateData.ageGroup = data.ageGroup;
    if (data.isBestseller !== undefined) updateData.isBestseller = data.isBestseller;
    // if (data.generationPrompt !== undefined)
    //   updateData.generationPrompt = data.generationPrompt;
    // if (data.generationNegativePrompt !== undefined)
    //   updateData.generationNegativePrompt = data.generationNegativePrompt;

    const updatedComic = await prisma.comic.update({
      where: { id: comicId },
      data: updateData,
    });

    for (const oldR2Key of oldR2KeysToDelete) {
      try {
        await deleteFile("public", oldR2Key);
        logger.info({ comicId, oldR2Key }, "Old comic thumbnail deleted from R2");
      } catch (error) {
        logger.warn({ error, comicId, oldR2Key }, "Failed to delete old comic thumbnail from R2");
      }
    }
    logger.info(
      { comicId, updatedFields: Object.keys(updateData) },
      "Successfully updated comic"
    );

    return updatedComic;
  } catch (error: any) {
    logger.error({ err: error, comicId }, "Failed to update comic");
    throw error;
  }
};

export async function deleteComic(comicId: string) {
  const comic = await prisma.comic.findUnique({
    where: { id: comicId },
    include: {
      pages: {
        select: { artworkUrl: true, maskUrl: true },
      },
      _count: {
        select: { orderSessions: true },
      },
    },
  });

  if (!comic) {
    throw new NotFoundError("Comic not found.");
  }

  if (comic.status === "PUBLISHED") {
    throw new ConflictError(
      "Cannot delete a published comic. Unpublish it first."
    );
  }

  // Check for active (non-terminal) order sessions
  const activeSessionCount = await prisma.orderSession.count({
    where: {
      comicId,
      status: {
        notIn: ["COMPLETED", "FAILED"],
      },
    },
  });

  if (activeSessionCount > 0) {
    throw new ConflictError(
      `Cannot delete this comic — it has ${activeSessionCount} active order session(s). Wait for them to complete or fail first.`
    );
  }

  // Collect ALL R2 keys we'll clean up BEFORE the DB delete — thumbnails plus
  // every page's artwork and mask. Nothing hits R2 yet; this is just planning.
  const publicBase = config.r2.publicUrlBase.replace(/\/$/, "");
  const thumbnailKeys = comic.coverThumbnailUrls.map((url) =>
    url.replace(`${publicBase}/`, "")
  );
  const pageAssetKeys = comic.pages.flatMap((p) =>
    [p.artworkUrl, p.maskUrl]
      .filter((url): url is string => Boolean(url))
      .map((url) => url.replace(`${publicBase}/`, ""))
  );

  // DB delete is the moment of truth. If it throws, we haven't touched R2 —
  // caller sees an error and the comic + all its assets stay intact, exactly
  // recoverable by retrying the delete. Pages cascade-delete in the DB via
  // the schema's onDelete: Cascade. (Audit 8.15 — DB first, R2 second.)
  await prisma.comic.delete({ where: { id: comicId } });

  // Best-effort R2 cleanup AFTER the DB delete succeeded. Failures here mean
  // orphaned files (wasted storage) but never rows pointing at 404s.
  for (const key of thumbnailKeys) {
    try {
      await deleteFile("public", key);
      logger.info({ comicId, key }, "Deleted comic thumbnail from R2");
    } catch (error) {
      logger.warn(
        { error, comicId, key },
        "Failed to delete comic thumbnail from R2 after DB delete — orphaned file"
      );
    }
  }

  for (const key of pageAssetKeys) {
    try {
      await deleteFile("public", key);
      logger.info({ comicId, key }, "Deleted page asset from R2");
    } catch (error) {
      logger.warn(
        { error, comicId, key },
        "Failed to delete page asset from R2 after DB delete — orphaned file"
      );
    }
  }

  logger.info(
    { comicId, thumbnailCount: thumbnailKeys.length, pageAssetCount: pageAssetKeys.length },
    "Comic deleted (pages + bubbles cascade-deleted, R2 assets swept)"
  );
}

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
          coverType: p.coverType,
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

export const getComicPricing = async (comicId: string) => {
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
    logger.error(
      { err: error, comicId },
      "Failed to fetch comic pricing rules"
    );
    throw error;
  }
};

export const updateComicStatus = async (
  comicId: string,
  data: UpdateComicStatusInput
) => {
  try {
    logger.info(
      { comicId, targetStatus: data.status },
      "Attempting to update comic status..."
    );

    const comic = await prisma.comic.findUnique({
      where: { id: comicId },
      include: { pricingRules: true },
    });

    if (!comic) {
      throw new NotFoundError("Comic not found.");
    }

    if (data.status === "PUBLISHED") {
      if (comic.coverThumbnailUrls.length === 0) {
        throw new ValidationError(
          "Cannot publish comic: at least one cover thumbnail is required."
        );
      }

      if (comic.pricingRules.length === 0) {
        throw new ValidationError(
          "Cannot publish comic: At least one pricing rule is required."
        );
      }
    }

    const updatedComic = await prisma.comic.update({
      where: { id: comicId },
      data: { status: data.status },
    });

    logger.info(
      { comicId, newStatus: updatedComic.status },
      "Successfully updated comic status"
    );
    return updatedComic;
  } catch (error: any) {
    logger.error({ err: error, comicId }, "Failed to update comic status");
    throw error;
  }
};

export const getPublicComicsList = async (filters: ComicFilterQueryInput) => {
  const where: Prisma.ComicWhereInput = {
    status: "PUBLISHED",
  };

  if (filters.gender !== undefined) {
    where.genderTag = filters.gender;
  }

  if (filters.ageGroup !== undefined) {
    where.ageGroup = filters.ageGroup;
  }

  if (filters.themeId !== undefined) {
    where.themeId = filters.themeId;
  }

  if (filters.search !== undefined && filters.search.trim() !== "") {
    where.title = {
      contains: filters.search.trim(),
      mode: "insensitive",
    };
  }

  return await prisma.comic.findMany({
    where,
    select: {
      id: true,
      title: true,
      description: true,
      genderTag: true,
      ageGroup: true,
      isBestseller: true,
      pageCount: true,
      coverThumbnailUrls: true,
      theme: {
        select: {
          id: true,
          name: true,
        },
      },
      pricingRules: {
        select: {
          price: true,
          coverType: true,
          country: {
            select: {
              code: true,
              name: true,
              flagUrl: true,
              currencyCode: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
};

export const getPublicComicDetails = async (comicId: string) => {
  const comic = await prisma.comic.findFirst({
    where: {
      id: comicId,
      status: "PUBLISHED",
    },
    select: {
      id: true,
      title: true,
      description: true,
      genderTag: true,
      ageGroup: true,
      isBestseller: true,
      pageCount: true,
      freePreviewPages: true,
      coverThumbnailUrls: true,
      theme: {
        select: {
          id: true,
          name: true,
        },
      },
      pricingRules: {
        select: {
          coverType: true,
          price: true,
          country: {
            select: {
              code: true,
              name: true,
              flagUrl: true,
              currencyCode: true,
            },
          },
        },
      },
      pages: {
        where: { isPreviewPage: true },
        orderBy: { pageNumber: "asc" },
        select: {
          id: true,
          pageNumber: true,
          artworkUrl: true,
          // Lets the frontend reserve the correct aspect-ratio box before the
          // preview image loads, avoiding layout shift in the carousel.
          artworkWidth: true,
          artworkHeight: true,
        },
      },
    },
  });

  if (!comic) {
    throw new NotFoundError("Comic not found or not available.");
  }

  return comic;
};

const LORA_UPLOAD_EXPIRY_SECONDS = 60 * 60;

export const getLoraUploadUrl = async (input: GetLoraUploadUrlInput) => {
  const safeFileName = input.fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
  const key = `comics/lora/${Date.now()}-${safeFileName}`;

  const uploadUrl = await getSignedUploadUrl(
    "private",
    key,
    "application/octet-stream",
    LORA_UPLOAD_EXPIRY_SECONDS
  );

  logger.info({ key }, "Generated LoRA upload URL");

  return { uploadUrl, key };
};

export async function getAdminComicsList(filters: AdminComicFilterQueryInput) {
  const where: Prisma.ComicWhereInput = {};

  if (filters.gender !== undefined) {
    where.genderTag = filters.gender;
  }

  if (filters.ageGroup !== undefined) {
    where.ageGroup = filters.ageGroup;
  }

  if (filters.themeId !== undefined) {
    where.themeId = filters.themeId;
  }

  if (filters.search !== undefined && filters.search.trim() !== "") {
    where.title = {
      contains: filters.search.trim(),
      mode: "insensitive",
    };
  }

  const comics = await prisma.comic.findMany({
    where,
    include: {
      theme: {
        select: {
          id: true,
          name: true,
        },
      },
      _count: {
        select: {
          pages: true,
          orderSessions: true,
          pricingRules: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return comics;
}

export const getAdminComicDetail = async (comicId: string) => {
  const comic = await prisma.comic.findUnique({
    where: { id: comicId },
    include: {
      theme: {
        select: {
          id: true,
          name: true,
        },
      },
      pages: {
        orderBy: { pageNumber: "asc" },
        include: {
          bubbles: {
            orderBy: { sortOrder: "asc" },
          },
        },
      },
      fonts: true,
      pricingRules: {
        include: {
          country: {
            select: {
              id: true,
              code: true,
              name: true,
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
      },
      _count: {
        select: {
          orderSessions: true,
        },
      },
    },
  });

  if (!comic) {
    throw new NotFoundError("Comic not found.");
  }

  logger.info({ comicId }, "Admin fetched comic detail");

  return comic;
};


export const generateThumbnailUploadUrlsBatch = async (
  files: UploadThumbnailsBatchInput["files"]
) => {
  logger.info(
    { count: files.length },
    "Generating batch of thumbnail upload URLs"
  );

  const uploads = await Promise.all(
    files.map((f) => generateThumbnailUploadUrl(f.fileName, f.contentType))
  );

  return { uploads };
};