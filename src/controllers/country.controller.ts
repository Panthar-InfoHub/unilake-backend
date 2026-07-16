import type { Request, Response } from "express";
import { success, z, ZodError, type ZodIssue } from "zod";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ValidationError } from "../utils/errors.js";
import { logger } from "../lib/logger.js";
import {
  generateFlagUploadUrl,
  createCountry,
  updateCountry,
  getAllCountries,
  deleteCountry
} from "../services/country.service.js";
import {
  createCountrySchema,
  updateCountrySchema,
} from "../validators/country.schema.js";

const uploadUrlRequestSchema = z.object({
  fileName: z.string().min(1, "file name is requried"),

  contentType: z
    .string()
    .regex(
      /^image\/(png|jpeg|jpg|svg\+xml|webp)$/,
      "Invalid content type. Only PNG, JPEG, SVG, and WEBP images are allowed."
    ),
});

export const getFlagUploadUrlHandler = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      logger.debug({ body: req.body }, "Incoming Request for floag upload URL");

      // validate the nncoming request
      const { fileName, contentType } = uploadUrlRequestSchema.parse(req.body);

      const { uploadUrl, key } = await generateFlagUploadUrl(
        fileName,
        contentType
      );

      res.status(200).json({
        success: true,
        message: "Presigned upload URL generated successfully",
        data: {
          uploadUrl,
          key,
        },
      });
    } catch (error: any) {
      if (error instanceof ZodError) {
        const errorMessages = error.issues
          .map((issue: ZodIssue) => issue.message)
          .join(",");

        throw new ValidationError(errorMessages);
      }
      throw error;
    }
  }
);

export const createCountryHandler = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      logger.debug({ body: req.body }, "Incoming request to create country");

      const validatedData = createCountrySchema.parse(req.body);

      const newCountry = await createCountry(validatedData);

      res.status(201).json({
        success: true,
        message: "Country record created successfully.",
        data: newCountry,
      });
    } catch (error) {
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

export const updateCountryHandler = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const { countryId } = req.params;
      logger.debug(
        { countryId, body: req.body },
        "Incoming request to update country"
      );

      if (!countryId) {
        throw new ValidationError(
          "Country ID is required in the URL parameters."
        );
      }

      const validatedData = updateCountrySchema.parse(req.body);

      if (Object.keys(validatedData).length === 0) {
        throw new ValidationError("No valid fields provided for update.");
      }

      const updatedCountry = await updateCountry(countryId, validatedData);


      res.status(200).json({
      success: true,
      message: "Country record updated successfully.",
      data: updatedCountry,
    });

    }catch (error) {
    if (error instanceof ZodError) {
      const errorMessages = error.issues
        .map((issue: ZodIssue) => issue.message)
        .join(", ");
      throw new ValidationError(errorMessages);
    }
    throw error;
  }
});

export const getAllCountriesHandler = asyncHandler(async (req: Request, res : Response)=> {
    logger.debug("Incoming request to fetch all countries");

    const countries = await getAllCountries();

    res.status(200).json({
        success: true,
        messages: "Countries fetched succesfully",
        data: countries
    })
}) 


export const deleteCountryHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { countryId } = req.params;

    if (!countryId || typeof countryId !== "string") {
      throw new ValidationError("Country ID is required.");
    }

    await deleteCountry(countryId);

    res.status(204).send();
  }
);
