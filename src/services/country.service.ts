import { randomUUID } from "node:crypto";
import { getPublicUrl, getSignedUploadUrl } from "../lib/r2.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";
import type {
  CreateCountryInput,
  UpdateCountryInput,
} from "../validators/country.schema.js";

export const generateFlagUploadUrl = async (
  fileName: string,
  contentType: string
) => {
  const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");

  const key = `flags/${randomUUID()}-${safeFileName}`;

  logger.info(
    { key, contentType },
    "Requesting presigned URL from Cloudflare R2"
  );

  const uploadUrl = await getSignedUploadUrl("public", key, contentType, 900);

  return { uploadUrl, key };
};

export const createCountry = async (data: CreateCountryInput) => {
  try {
    logger.info(
      { code: data.code, name: data.name },
      "Attempting to create new country record..."
    );

    const resolvedFlagUrl = getPublicUrl(data.flagKey);

    const newCountry = await prisma.country.create({
      data: {
        code: data.code,
        name: data.name,
        currencyCode: data.currencyCode,
        flagUrl: resolvedFlagUrl, // ⬅️ Map the resolved URL to the Prisma schema field
      },
    });

    logger.info({ countryId: newCountry.id }, "Successfully created country");

    return newCountry;
  } catch (error: any) {
    logger.error({ err: error, data }, "Failed to create country in database");

    if (error.code === "P2002") {
      throw new ConflictError(
        `A country with the code '${data.code}' already exists.`
      );
    }

    throw error;
  }
};

export const updateCountry = async (
  countryId: any,
  data: UpdateCountryInput
) => {
  try {
    logger.info(
      { countryId },
      "Attempting to update existing country record..."
    );

    let finalFlagUrl: string | undefined;

    if (data.flagKey) {
      finalFlagUrl = getPublicUrl(data.flagKey);
    }

    const updatedCountry = await prisma.country.update({
      where: { id: countryId },
      data: {
        ...(data.code !== undefined && { code: data.code }),
        ...(data.name !== undefined && { name: data.name }),
        ...(data.currencyCode !== undefined && {
          currencyCode: data.currencyCode,
        }),
        ...(finalFlagUrl !== undefined && { flagUrl: finalFlagUrl }),
      },
    });

    logger.info({ countryId }, "Successfully updated country");
    return updatedCountry;
  } catch (error: any) {
    logger.error({ err: error, countryId, data }, "Failed to update country");
    if (error.code === "P2025") {
      throw new NotFoundError("The requested country record does not exist.");
    }
    if (error.code === "P2002") {
      throw new ConflictError("A country with this code already exists.");
    }
    throw error;
  }
};

export const getAllCountries = async () => {
  try {
    logger.debug("Fetching all countries from the database...");

    const countries = await prisma.country.findMany({
      orderBy: {
        name: "asc",
      },
    });

    return countries;
  } catch (error: any) {
    logger.error({ err: error }, "Failed to fetch countries from the database");
    throw error;
  }
};
