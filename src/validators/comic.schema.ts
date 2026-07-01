import { z } from "zod";

export const createComicSchema = z
  .object({
    title: z
      .string({ message: "Title is requried" })
      .min(1, "Title cannot be empty")
      .max(255, "Title is too long"),

    genderTag: z.enum(["BOY", "GIRL", "UNISEX"] as const, {
      message:
        "Gender tag is required and must be exactly BOY, GIRL, or UNISEX",
    }),

    pageCount: z
      .number({ message: "Page count is required" })
      .int("Page count must be a whole number")
      .positive("Page count must be at least 1"),

    freePreviewPages: z
      .number({ message: "Free preview pages count is required" })
      .int("Free preview pages must be a whole number")
      .nonnegative("Free preview pages cannot be negative"),

    thumbnailKey: z
      .string({ message: "Thumbnail key is required" })
      .min(1, "Thumbnail key cannot be empty"),

    pricing: z
      .array(
        z.object({
          countryId: z
            .string()
            .uuid("Invalid country ID format. Must be a valid UUID."),
          price: z
            .number()
            .positive("Price must be a positive number greater than 0."),
        })
      )
      .min(1, "You must provide at least one pricing rule for the comic."),

    loraKey: z.string().min(1).optional(),
    loraStrength: z.number().min(0).max(2).optional(),
  })
  .refine((data) => data.freePreviewPages < data.pageCount, {
    message:
      "Free preview pages must be strictly less than the total page count.",
    path: ["freePreviewPages"],
  });

export const updateComicPricingSchema = z.object({
  pricing: z
    .array(
      z.object({
        countryId: z.string().uuid("Invalid country ID format."),
        price: z.number().positive("Price must be positive."),
      })
    )
    .min(1, "You must provide at least one pricing rule."),
});

export const updateComicStatusSchema = z.object({
  status: z.enum(["DRAFT", "PUBLISHED", "UNPUBLISHED"], {
    message: "Invalid status. Must be DRAFT, PUBLISHED, or UNPUBLISHED.",
  }),
});

export const comicFilterQuerySchema = z.object({
  gender: z
    .enum(["BOY", "GIRL", "UNISEX"], {
      message: "Invalid gender filter. Must be BOY, GIRL, or UNISEX.",
    })
    .optional(), // Marks it as optional so /api/comics works without it
});

export const updateComicSchema = z
  .object({
    title: z.string().min(1).optional(),
    genderTag: z.enum(["BOY", "GIRL", "UNISEX"]).optional(),
    pageCount: z.number().int().positive().optional(),
    freePreviewPages: z.number().int().positive().optional(),
    loraStrength: z.number().min(0).max(2).optional(),
    loraKey: z.string().min(1).optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "At least one field must be provided to update",
  });

export const getLoraUploadUrlSchema = z.object({
  fileName: z.string().min(1),
});

export type CreateComicInput = z.infer<typeof createComicSchema>;
export type UpdateComicPricingInput = z.infer<typeof updateComicPricingSchema>;
export type UpdateComicStatusInput = z.infer<typeof updateComicStatusSchema>;
export type ComicFilterQueryInput = z.infer<typeof comicFilterQuerySchema>;
export type UpdateComicInput = z.infer<typeof updateComicSchema>;
export type GetLoraUploadUrlInput = z.infer<typeof getLoraUploadUrlSchema>;

// export const updateComicSchema = createComicSchema.partial();
// export type UpdateComicInput = z.infer<typeof updateComicSchema>;
