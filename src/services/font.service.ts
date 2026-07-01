import { prisma } from "../lib/prisma.js";
import { getSignedUploadUrl } from "../lib/r2.js";
import { NotFoundError } from "../utils/errors.js";
import { logger } from "../lib/logger.js";
import type {
  GetFontUploadUrlInput,
  CreateFontInput,
} from "../validators/font.schema.js";

const FONT_UPLOAD_EXPIRY_SECONDS = 10 * 60;

const FONT_CONTENT_TYPE_MAP: Record<string, string> = {
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};

export async function getFontUploadUrl(
  comicId: string,
  input: GetFontUploadUrlInput
) {
  const comic = await prisma.comic.findUnique({ where: { id: comicId } });

  if (!comic) {
    throw new NotFoundError("Comic not found");
  }

  const { fileExtension } = input;
  const contentType = FONT_CONTENT_TYPE_MAP[fileExtension];
  const key = `comics/${comicId}/fonts/${Date.now()}.${fileExtension}`;

  const uploadUrl = await getSignedUploadUrl(
    "private",
    key,
    contentType!,
    FONT_UPLOAD_EXPIRY_SECONDS
  );

  return { uploadUrl, key };
}

export async function createFont(comicId: string, input: CreateFontInput) {
  const comic = await prisma.comic.findUnique({ where: { id: comicId } });

  if (!comic) {
    throw new NotFoundError("Comic not found");
  }

  const font = await prisma.font.create({
    data: {
      comic: { connect: { id: comicId } },
      name: input.name,
      fileUrl: input.fontKey,   
    },
  });

  logger.info({ comicId, fontId: font.id }, "Font created successfully");
  return font;
}
