import { prisma } from "../lib/prisma.js";
import { getSignedUploadUrl } from "../lib/r2.js";
import { NotFoundError, ConflictError } from "../utils/errors.js";
import { logger } from "../lib/logger.js";
import type {
  GetFontUploadUrlInput,
  CreateFontInput,
  UpdateFontInput,
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


export async function listComicFonts(comicId: string) {
  const comic = await prisma.comic.findUnique({
    where: { id: comicId },
    select: { id: true },
  });

  if (!comic) {
    throw new NotFoundError("Comic not found");
  }

  const fonts = await prisma.font.findMany({
    where: { comicId },
    include: {
      _count: {
        select: { bubbles: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  logger.info({ comicId, fontCount: fonts.length }, "Listed comic fonts");

  return fonts;
}

export async function updateFont(fontId: string, input: UpdateFontInput) {
  const font = await prisma.font.findUnique({
    where: { id: fontId },
  });

  if (!font) {
    throw new NotFoundError("Font not found");
  }

  const data: { name?: string; fileUrl?: string } = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.fontKey !== undefined) data.fileUrl = input.fontKey;

  const updated = await prisma.font.update({
    where: { id: fontId },
    data,
  });

  logger.info(
    { fontId, comicId: font.comicId, fields: Object.keys(data) },
    "Font updated"
  );

  return updated;
}

export async function deleteFont(fontId: string) {
  const font = await prisma.font.findUnique({
    where: { id: fontId },
  });

  if (!font) {
    throw new NotFoundError("Font not found");
  }

  const bubbleCount = await prisma.bubble.count({
    where: { fontId },
  });

  if (bubbleCount > 0) {
    throw new ConflictError(
      `Cannot delete font "${font.name}" — ${bubbleCount} bubble(s) reference it. Unassign the font from those bubbles first.`
    );
  }

  await prisma.font.delete({
    where: { id: fontId },
  });

  logger.info(
    { fontId, comicId: font.comicId, fontName: font.name },
    "Font deleted"
  );
}
