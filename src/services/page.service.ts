import { prisma } from "../lib/prisma.js";
import { getSignedUploadUrl } from "../lib/r2.js";
import { NotFoundError, ConflictError } from "../utils/errors.js";
import { logger } from "../lib/logger.js";
import { Prisma } from "../generated/prisma/client.js";
import type {
  CreatePageInput,
  GetPageArtworkUploadUrlInput,
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
