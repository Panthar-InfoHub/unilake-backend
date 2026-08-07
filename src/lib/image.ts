import sharp from "sharp";
import { ValidationError } from "../utils/errors.js";
import { logger } from "./logger.js";

export type ImageDimensions = {
  width: number;
  height: number;
};

/**
 * Reads the real pixel dimensions of an image buffer.
 *
 * Used to (a) record Page.artworkWidth/artworkHeight, (b) verify a mask matches
 * its artwork pixel-for-pixel, and (c) detect aspect-ratio changes when artwork
 * is replaced. The SD worker imports from this module too.
 *
 * @param buffer - Raw image bytes, typically from downloadFileToBuffer()
 * @param label - Human-readable name used in error messages, e.g. "artwork"
 * @throws ValidationError if the buffer is not a readable image
 */
export const probeImageDimensions = async (
  buffer: Buffer,
  label = "image"
): Promise<ImageDimensions> => {
  let metadata;

  try {
    metadata = await sharp(buffer).metadata();
  } catch (error) {
    logger.warn({ error, label }, "Sharp failed to read image metadata");
    throw new ValidationError(
      `The uploaded ${label} could not be read as an image. Upload a valid PNG, JPEG or WEBP file.`
    );
  }

  // Sharp resolves without throwing for some malformed files, but leaves
  // width/height undefined — treat that as unreadable rather than trusting it.
  if (!metadata.width || !metadata.height) {
    logger.warn({ label, metadata }, "Image metadata missing dimensions");
    throw new ValidationError(
      `Could not determine the dimensions of the uploaded ${label}. The file may be corrupt.`
    );
  }

  return { width: metadata.width, height: metadata.height };
};
