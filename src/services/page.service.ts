import { prisma } from "../lib/prisma.js";
import { getSignedUploadUrl } from "../lib/r2.js";
import { NotFoundError, ConflictError } from "../utils/errors.js";
import { logger } from "../lib/logger.js";
import type { Prisma } from "../generated/prisma/client.js";
import type {
  CreatePageInput,
  GetPageArtworkUploadUrlInput,
  UpdatePageInput,
} from "../validators/page.schema.js";

const PAGE_ASSET_UPLOAD_EXPIRY_SECONDS = 15 * 60;

export async function getPageArtworkUploadUrl(
  comicId: string,
  input: GetPageArtworkUploadUrlInput
) {
  const comic = await prisma.comic.findUnique({ where: { id: comicId } });

  if (!comic) {
    throw new NotFoundError(
      "Comic not found while creating the page for that comic"
    );
  }

  const { fileExtension, fileType } = input;

  const contentTypeMap: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };

  const contentType = contentTypeMap[fileExtension];
  const folder = fileType === "masks" ? "masks" : "artwork";
  const key =
    "comics/${comicId}/pages/${folder}/${Date.now()}.${fileExtension}";

  const uploadUrl = await getSignedUploadUrl(
    "private",
    key,
    contentType!,
    PAGE_ASSET_UPLOAD_EXPIRY_SECONDS
  );

  return { uploadUrl, key };
}

export async function createPage(comicId: string, input: CreatePageInput) {
  const comic = await prisma.comic.findUnique({ where: { id: comicId } });

  if (!comic) {
    throw new NotFoundError("Comic not found");
  }

  const data: Prisma.PageCreateInput = {
    comic: { connect: { id: comicId } },
    pageNumber: input.pageNumber,
    hasFace: input.hasFace,
    mirrorFace: input.mirrorFace,
    isPreviewPage: input.isPreviewPage,
  };

  if (input.artworkUrl !== undefined) data.artworkUrl = input.artworkUrl;
  if (input.maskUrl !== undefined) data.maskUrl = input.maskUrl;
  if (input.faceDirection !== undefined) data.faceDirection = input.faceDirection;
  if (input.pagePrompt !== undefined) data.pagePrompt = input.pagePrompt;

  
  try {
    const page = await prisma.page.create({ data });
    logger.info(
      { comicId, pageId: page.id, pageNumber: page.pageNumber },
      "Page created successfully"
    );
    return page;
  } catch (error: any) {
    if (error.code === "P2002") {
      throw new ConflictError(
        `Page number ${input.pageNumber} already exists for this comic`
      );
    }
    throw error;
  }
}


export async function listComicPages(comicId: string) {
  const comic = await prisma.comic.findUnique({
    where: { id: comicId },
    select: { id: true },
  });

  if (!comic) {
    throw new NotFoundError("Comic not found");
  }

  const pages = await prisma.page.findMany({
    where: { comicId },
    orderBy: { pageNumber: "asc" },
    include: {
      bubbles: {
        orderBy: { sortOrder: "asc" },
        include: {
          font: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  logger.info({ comicId, pageCount: pages.length }, "Listed comic pages");

  return pages;
}

export async function updatePage(pageId: string, input: UpdatePageInput) {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
  });

  if (!page) {
    throw new NotFoundError("Page not found");
  }

  const data: Prisma.PageUpdateInput = {};
  if (input.hasFace !== undefined) data.hasFace = input.hasFace;
  if (input.mirrorFace !== undefined) data.mirrorFace = input.mirrorFace;
  if (input.faceDirection !== undefined) data.faceDirection = input.faceDirection;
  if (input.isPreviewPage !== undefined) data.isPreviewPage = input.isPreviewPage;
  if (input.pagePrompt !== undefined) data.pagePrompt = input.pagePrompt;
  if (input.artworkUrl !== undefined) data.artworkUrl = input.artworkUrl;
  if (input.maskUrl !== undefined) data.maskUrl = input.maskUrl;

  const updated = await prisma.page.update({
    where: { id: pageId },
    data,
  });

  logger.info(
    { pageId, comicId: page.comicId, fields: Object.keys(data) },
    "Page updated"
  );

  return updated;
}

export async function deletePage(pageId: string) {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
  });

  if (!page) {
    throw new NotFoundError("Page not found");
  }

  await prisma.page.delete({
    where: { id: pageId },
  });

  logger.info(
    { pageId, comicId: page.comicId, pageNumber: page.pageNumber },
    "Page deleted (bubbles cascade-deleted)"
  );
}
